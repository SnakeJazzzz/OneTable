import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Load `.env.local` into process.env using pure Node fs. The project
 * deliberately avoids `dotenv` for supply-chain reasons (see commit 62035f0
 * "replace dotenv with setup file using Node fs").
 *
 * Keys already present in process.env always win — CI and Vercel inject real
 * env vars and must not be overridden by a stale local file.
 *
 * Shared by tests/setup.ts and scripts/db-guard.ts. scripts/seed.ts and
 * scripts/preflight.ts keep inline copies that predate this module (left
 * untouched to keep the hardening T1 diff minimal).
 */
export function loadEnvLocal(): void {
  const envPath = resolve(process.cwd(), '.env.local');
  try {
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let value = trimmed.slice(eqIdx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {
    // .env.local optional (e.g., CI uses real env vars instead).
  }
}
