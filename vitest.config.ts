import { defineConfig } from 'vitest/config';
import { config as dotenvConfig } from 'dotenv';

// Load .env.local for DATABASE_URL (used by DB integration tests)
dotenvConfig({ path: '.env.local' });

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: { provider: 'v8', include: ['core/**/*.ts'] },
    testTimeout: 60000,
  },
  resolve: {
    alias: { '@': new URL('.', import.meta.url).pathname },
  },
});
