/**
 * scripts/seed.ts — OneTable Fase 1 static seed.
 *
 * Per spec §6.1 and plan S10, this seed is STRICTLY static data:
 *  - 1 demo User
 *  - 1 demo Client (VIKS Jerky Co.)
 *  - Product catalog imported from docs/specs/viks-data/catalogo-productos.xlsx
 *    (via core/catalog/import.ts — single source of truth, no hardcoding)
 *  - 6 PortalCredential rows (one per Chain) with placeholder usernames and
 *    hasPasswordPending=true. Password storage is deferred to Fase 2 with KMS
 *    (spec §6.1, §10).
 *
 * SelloutData / Upload / UnmappedProduct are intentionally left empty. The
 * demo IS the live upload at /analisis (spec §6.3).
 *
 * Idempotent: TRUNCATE ... RESTART IDENTITY CASCADE before insert, so running
 * twice converges to the same state.
 *
 * Production guard: refuses to run when NODE_ENV=production unless --force is
 * passed (plan S10 Step 1).
 */

import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Load .env.local manually (pure Node fs — same approach as tests/setup.ts;
// project deliberately avoids `dotenv` for supply chain reasons — see commit
// 62035f0 "replace dotenv with setup file using Node fs"). Must run BEFORE
// `import('@prisma/client')` so DATABASE_URL is set when PrismaClient resolves.
function loadEnvLocal() {
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
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // .env.local optional (e.g., CI/Vercel injects env vars natively).
  }
}
loadEnvLocal();

import { PrismaClient, type Chain } from '@prisma/client';
import { hash } from 'bcryptjs';
import { importCatalog } from '../core/catalog/import';

const ALL_CHAINS: Chain[] = [
  'SORIANA',
  'CHEDRAUI',
  'HEB',
  'AL_SUPER',
  'LA_COMER',
  'AMAZON',
];

export const DEMO_USER_EMAIL = 'demo@onetable.mx';
export const DEMO_USER_PASSWORD = 'demo1234';
export const DEMO_USER_NAME = 'Demo VIKS';
export const DEMO_CLIENT_NAME = 'VIKS Jerky Co.';

const CATALOG_RELATIVE_PATH = '../docs/specs/viks-data/catalogo-productos.xlsx';

/**
 * Run the static seed. If `externalDb` is passed (e.g. from preflight) the
 * caller owns the client lifecycle; otherwise we create one and disconnect.
 *
 * Exported so `scripts/preflight.ts` can reuse this exact logic without
 * spawning a subprocess. See S11 handoff for the (a) subprocess vs
 * (b) refactor decision.
 */
export async function main(externalDb?: PrismaClient): Promise<void> {
  const db = externalDb ?? new PrismaClient();
  const ownsDb = externalDb === undefined;
  try {
    // Production guard (spec §6.1 step 2)
    if (process.env.NODE_ENV === 'production' && !process.argv.includes('--force')) {
      throw new Error(
        'Refusing to seed production without --force. Re-run with `tsx scripts/seed.ts --force` if you really mean it.',
      );
    }

    const startedAt = Date.now();

    console.log('[seed] Truncating tables (RESTART IDENTITY CASCADE)…');
    // Order respects FK dependencies; CASCADE makes it defensive against any
    // future indirect FK we might miss. Listing children-before-parents keeps the
    // statement readable.
    await db.$executeRawUnsafe(`
      TRUNCATE TABLE "SelloutData", "UnmappedProduct", "Upload",
                     "ProductMapping", "Product", "PortalCredential",
                     "Client", "User"
      RESTART IDENTITY CASCADE;
    `);

    console.log('[seed] Creating demo user + client…');
    const user = await db.user.create({
      data: {
        email: DEMO_USER_EMAIL,
        passwordHash: await hash(DEMO_USER_PASSWORD, 10),
        name: DEMO_USER_NAME,
      },
    });
    const client = await db.client.create({
      data: { name: DEMO_CLIENT_NAME, userId: user.id },
    });

    console.log('[seed] Importing catalogo-productos.xlsx via core/catalog/import…');
    const catalogPath = resolve(__dirname, CATALOG_RELATIVE_PATH);
    const buf = await readFile(catalogPath);
    const stats = await importCatalog({ clientId: client.id, fileBuffer: buf }, db);
    console.log(
      `[seed] Catalog import: created=${stats.productsCreated} existing=${stats.productsExisting} ` +
        `mappingsCreated=${stats.mappingsCreated} mappingsSkippedDuplicate=${stats.mappingsSkippedDuplicate}`,
    );
    if (stats.warnings.length > 0) {
      console.log(`[seed] Catalog warnings (${stats.warnings.length}):`);
      for (const w of stats.warnings) console.log(`  - ${w}`);
    }

    console.log('[seed] Creating PortalCredential rows for all 6 chains…');
    for (const chain of ALL_CHAINS) {
      await db.portalCredential.create({
        data: {
          clientId: client.id,
          chain,
          username: chain === 'AMAZON' ? 'viks-demo@example.com' : 'viks-demo',
          isActive: true,
          hasPasswordPending: true,
        },
      });
    }

    const counts = {
      users: await db.user.count(),
      clients: await db.client.count(),
      products: await db.product.count(),
      mappings: await db.productMapping.count(),
      portalCredentials: await db.portalCredential.count(),
      selloutData: await db.selloutData.count(),
      unmappedProducts: await db.unmappedProduct.count(),
      uploads: await db.upload.count(),
    };

    const elapsedMs = Date.now() - startedAt;
    console.log(
      `[seed] Done in ${elapsedMs}ms — ` +
        `users=${counts.users}, clients=${counts.clients}, products=${counts.products}, ` +
        `mappings=${counts.mappings}, portal_creds=${counts.portalCredentials}, ` +
        `sellout=${counts.selloutData}, unmapped=${counts.unmappedProducts}, uploads=${counts.uploads}`,
    );
    console.log(
      '[seed] SelloutData empty intentionally — upload sample files via /analisis during demo.',
    );
  } finally {
    if (ownsDb) await db.$disconnect();
  }
}

// CLI entrypoint guard: only run when invoked directly via tsx (not when
// imported by preflight). tsx supports CommonJS-style `require.main === module`
// — equivalent to ESM `import.meta.url === pathToFileURL(process.argv[1]).href`.
if (require.main === module) {
  main().catch(err => {
    console.error('[seed] FAILED:', err);
    process.exitCode = 1;
  });
}
