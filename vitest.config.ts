import { defineConfig } from 'vitest/config';

// .env.local is loaded by tests/setup.ts (pure Node fs, no third-party dotenv).
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: { provider: 'v8', include: ['core/**/*.ts'] },
    testTimeout: 60000,
    setupFiles: ['./tests/setup.ts'],
    // All test files share ONE Neon DB. Most files coexist via disjoint email
    // namespaces, but tests/seed/seed.test.ts runs the real seed which does a
    // global TRUNCATE ... CASCADE — that would wipe a parallel file's rows
    // mid-test. Serialize file execution so the truncate can't race; each file
    // is self-contained (own beforeAll setup) so order is irrelevant.
    fileParallelism: false,
  },
  resolve: {
    alias: { '@': new URL('.', import.meta.url).pathname },
  },
});
