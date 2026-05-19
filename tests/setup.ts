import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

// NextAuth v5 throws at runtime if AUTH_SECRET is unset. After loading
// .env.local (which usually sets it), fall back to a sentinel so tests that
// import @/auth don't fail on misconfigured local envs.
if (!process.env.AUTH_SECRET) {
  process.env.AUTH_SECRET = 'test-only-secret-do-not-use-in-prod';
}
