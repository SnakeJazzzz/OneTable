/**
 * scripts/db-guard.ts — CLI runner for the DB environment guard
 * (hardening T1).
 *
 * Used as a pre-command by `pnpm db:reset` (package.json) so
 * `prisma migrate reset --force` can never run against the Neon production
 * branch — or against any remote host missing the explicit
 * ONETABLE_DB_ENV=development marker. Guard logic lives in lib/db-guard.ts
 * (pure, unit-tested); this file only wires env loading + process exit.
 *
 * Exit 0 = allowed; exit 1 = blocked (reason on stderr).
 */

import { loadEnvLocal } from '../lib/env-local';
import { checkDbGuard, DB_ENV_MARKER } from '../lib/db-guard';

loadEnvLocal();

const verdict = checkDbGuard(
  process.env.DATABASE_URL,
  process.env[DB_ENV_MARKER],
);

if (!verdict.allowed) {
  console.error(`❌ ${verdict.reason}`);
  process.exit(1);
}

console.log('✅ DB guard: host permitido para operaciones destructivas locales.');
