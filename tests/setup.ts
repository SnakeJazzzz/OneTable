import { loadEnvLocal } from '../lib/env-local';
import { checkDbGuard, DB_ENV_MARKER } from '../lib/db-guard';

loadEnvLocal();

// DB environment guard (hardening T1): abort the whole suite BEFORE any test
// touches the DB when DATABASE_URL points at the Neon production endpoint, or
// at any remote host lacking the explicit ONETABLE_DB_ENV=development marker.
// CI passes without the marker because its DATABASE_URL host is localhost
// (ephemeral postgres service container — see .github/workflows/ci.yml).
const verdict = checkDbGuard(
  process.env.DATABASE_URL,
  process.env[DB_ENV_MARKER],
);
if (!verdict.allowed) {
  throw new Error(verdict.reason);
}

// NextAuth v5 throws at runtime if AUTH_SECRET is unset. After loading
// .env.local (which usually sets it), fall back to a sentinel so tests that
// import @/auth don't fail on misconfigured local envs.
if (!process.env.AUTH_SECRET) {
  process.env.AUTH_SECRET = 'test-only-secret-do-not-use-in-prod';
}
