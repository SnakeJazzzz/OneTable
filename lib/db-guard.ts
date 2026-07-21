/**
 * lib/db-guard.ts — environment guard for destructive local DB operations
 * (hardening T1, 2026-07-20).
 *
 * Double mechanism:
 *  1. HOST BLOCKLIST — the Neon PRODUCTION and STAGING endpoint IDs are
 *     hardcoded below (a hostname without credentials is not a secret). Any
 *     DATABASE_URL whose host belongs to either endpoint is rejected
 *     UNCONDITIONALLY: tests, seed and db:reset must never touch production
 *     or staging (the previews DB), marker or no marker. Staging is restored
 *     via "Reset from parent" in the Neon console, never rebuilt locally.
 *  2. EXPLICIT MARKER — any other REMOTE host additionally requires
 *     ONETABLE_DB_ENV=development in the environment (normally set in
 *     .env.local). This stops a copied/stale connection string from silently
 *     pointing local tooling at a shared Neon branch.
 *
 * localhost / 127.0.0.1 / ::1 are allowed WITHOUT the marker so CI (ephemeral
 * postgres service container, no .env.local, no marker) stays green with zero
 * changes to ci.yml — hard requirement of the T1 brief.
 *
 * Pure logic, no I/O: unit-tested without a database in
 * tests/lib/db-guard.test.ts. Callers: tests/setup.ts, scripts/seed.ts,
 * scripts/db-guard.ts (pre-command of `pnpm db:reset`).
 *
 * Rejection messages are operator-facing (Michael) — Spanish by project
 * convention.
 */

/**
 * Neon endpoint ID of the PRODUCTION branch (project quiet-dawn-60852807).
 * Covers both the pooled (`<id>-pooler.<region>...`) and direct
 * (`<id>.<region>...`) hostnames. Captured empirically from the production
 * connection string on 2026-07-20 — hostname only, never the full URL.
 */
export const PRODUCTION_NEON_ENDPOINT_ID = 'ep-muddy-bar-ap8e9lyb';

/**
 * Neon endpoint ID of the STAGING branch (previews DB, same project).
 * Blocked unconditionally like production: staging is restored via
 * "Reset from parent" in the Neon console, never rebuilt from local tooling.
 * Confirmed by Michael in the Neon console on 2026-07-20 (F-2 decision,
 * resolves open question §5.1 of the T1 implementer report).
 */
export const STAGING_NEON_ENDPOINT_ID = 'ep-lingering-salad-apedj0u3';

/** Env var name of the explicit environment marker (set in .env.local). */
export const DB_ENV_MARKER = 'ONETABLE_DB_ENV';

/** The only marker value that authorizes remote non-production hosts. */
export const DB_ENV_EXPECTED = 'development';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

const RUNBOOK = 'docs/runbooks/t1-entornos-runbook.md';

export type DbGuardVerdict =
  | { allowed: true }
  | { allowed: false; reason: string };

/**
 * Extract the hostname from a connection string. Returns null when the URL
 * cannot be parsed (the guard treats that as a rejection — fail closed).
 */
export function extractDbHost(databaseUrl: string): string | null {
  try {
    const { hostname } = new URL(databaseUrl);
    // Node's WHATWG URL keeps brackets around IPv6 hostnames ("[::1]").
    // Lowercase the host: WHATWG URL does NOT case-normalize hostnames for
    // non-special schemes like postgresql://, but DNS/TLS resolution is
    // case-insensitive — without this, an uppercased production hostname
    // would slip past the blocklist (fail-open).
    const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return host === '' ? null : host;
  } catch {
    return null;
  }
}

/**
 * True when the host belongs to the given Neon endpoint: bare endpoint id,
 * direct (`<id>.<region>...`) or pooled (`<id>-pooler.<region>...`) hostname.
 */
function hostBelongsToEndpoint(host: string, endpointId: string): boolean {
  return (
    host === endpointId ||
    host.startsWith(`${endpointId}.`) ||
    host.startsWith(`${endpointId}-pooler.`)
  );
}

/** True when the host belongs to the Neon production endpoint. */
export function isProductionHost(host: string): boolean {
  return hostBelongsToEndpoint(host, PRODUCTION_NEON_ENDPOINT_ID);
}

/** True when the host belongs to the Neon staging endpoint (previews DB). */
export function isStagingHost(host: string): boolean {
  return hostBelongsToEndpoint(host, STAGING_NEON_ENDPOINT_ID);
}

/**
 * Decide whether a destructive local DB operation (test suite, seed,
 * migrate reset) may proceed against `databaseUrl`.
 */
export function checkDbGuard(
  databaseUrl: string | undefined,
  marker: string | undefined,
): DbGuardVerdict {
  if (!databaseUrl) {
    return {
      allowed: false,
      reason:
        'DB guard: DATABASE_URL no está definido en el entorno. Carga tu ' +
        '.env.local con el connection string de la branch development de ' +
        `Neon (ver ${RUNBOOK}, paso 0).`,
    };
  }

  const host = extractDbHost(databaseUrl);
  if (!host) {
    return {
      allowed: false,
      reason:
        'DB guard: no se pudo extraer el hostname de DATABASE_URL (formato ' +
        'inválido). Por seguridad la operación se bloquea. Revisa tu ' +
        '.env.local.',
    };
  }

  if (isProductionHost(host)) {
    return {
      allowed: false,
      reason:
        'DB guard: DATABASE_URL apunta al endpoint de PRODUCTION de Neon ' +
        `(host: ${host}). Tests, seed y db:reset están bloqueados contra ` +
        'production SIEMPRE. Cambia tu .env.local al connection string de ' +
        'la branch development y agrega ONETABLE_DB_ENV=development (ver ' +
        `${RUNBOOK}, paso 0).`,
    };
  }

  if (isStagingHost(host)) {
    return {
      allowed: false,
      reason:
        'DB guard: DATABASE_URL apunta al endpoint de STAGING de Neon ' +
        `(host: ${host}), la DB de las previews. Tests, seed y db:reset ` +
        'están bloqueados contra staging SIEMPRE. Si necesitas reponer ' +
        'staging, usa "Reset from parent" en la consola de Neon. Las ' +
        'operaciones destructivas locales van contra la branch development ' +
        `(ver ${RUNBOOK}, paso 0).`,
    };
  }

  if (LOCAL_HOSTS.has(host)) {
    // Local Postgres (CI service container o instancia local): sin marker.
    return { allowed: true };
  }

  if (marker !== DB_ENV_EXPECTED) {
    return {
      allowed: false,
      reason:
        `DB guard: DATABASE_URL apunta a un host remoto (${host}) sin el ` +
        `marker ${DB_ENV_MARKER}=${DB_ENV_EXPECTED} en el entorno. Si este ` +
        'host es la branch development de Neon, agrega ' +
        `${DB_ENV_MARKER}=${DB_ENV_EXPECTED} a tu .env.local (ver ` +
        `${RUNBOOK}, paso 0). Si no lo es, NO corras operaciones ` +
        'destructivas contra él.',
    };
  }

  return { allowed: true };
}
