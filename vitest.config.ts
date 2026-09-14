import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // The end-to-end tests open real sockets on ephemeral ports. Never a fixed
    // port in 31414 to 31416: the production backend runs on this PC.
    testTimeout: 15000,
  },
});
