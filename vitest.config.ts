// vitest.config.ts
import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: { provider: 'v8', include: ['core/**/*.ts'] },
  },
  resolve: {
    alias: { '@': resolve(__dirname, '.') },
  },
});
