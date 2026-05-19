import { defineConfig } from 'vitest/config';

// .env.local is loaded by tests/setup.ts (pure Node fs, no third-party dotenv).
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: { provider: 'v8', include: ['core/**/*.ts'] },
    testTimeout: 60000,
    setupFiles: ['./tests/setup.ts'],
  },
  resolve: {
    alias: { '@': new URL('.', import.meta.url).pathname },
  },
});
