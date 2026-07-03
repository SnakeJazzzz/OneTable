import { defineConfig } from 'vitest/config';

// .env.local is loaded by tests/setup.ts (pure Node fs, no third-party dotenv).
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: { provider: 'v8', include: ['core/**/*.ts'] },
    testTimeout: 60000,
    setupFiles: ['./tests/setup.ts'],
    // Shared-DB test invariant. Every test file runs against ONE shared dev DB.
    // Most files coexist via disjoint email/clientId namespaces + self-cleanup;
    // the exception is tests/seed/seed.test.ts, which runs the real seed
    // (scripts/seed.ts main()) — a process-global TRUNCATE ... CASCADE that wipes
    // EVERY file's rows, not just its own.
    //
    // fileParallelism:false → files run serially within ONE process, so the seed
    // truncate never races another live file (each file is self-contained; order
    // is irrelevant under serial execution).
    //
    // GOTCHA (cross-PROCESS): do NOT run two `pnpm test` processes at once against
    // the shared dev DB — one process's seed TRUNCATE deletes the clients/products
    // the other's inserts FK-reference (empirically: *_clientId_fkey violations,
    // ~4-7/run). This is a cross-process hazard, not intra-suite ordering.
    // CI is immune: .github/workflows/ci.yml uses a dedicated postgres:16 service
    // + a single `pnpm test` process (not the shared dev DB) — NOT a CI blocker.
    // True concurrent-safety (isolated DB/schema per process) is an infra follow-up.
    fileParallelism: false,
  },
  resolve: {
    alias: { '@': new URL('.', import.meta.url).pathname },
  },
});
