/**
 * scripts/preflight.ts — OneTable end-to-end pipeline validation (S11).
 *
 * Purpose: validate the full flow Parse → Normalize → UPSERT → KPI queries →
 * Alert classification, against real VIKS sample files, BEFORE every deploy
 * or live demo. Pass/fail is binary: exit 0 = green light, exit 1 = something
 * regressed.
 *
 * ⚠ DESTRUCTIVE: this script TRUNCATEs the DB at start and again at end
 * (try/finally). Operational order on demo day:
 *
 *     1. pnpm preflight       ← validates pipeline, leaves DB EMPTY
 *     2. pnpm db:seed         ← repopulates demo user/client/catalog
 *     3. Live demo at /analisis (upload the 4 samples manually)
 *
 * NEVER run `pnpm db:seed` followed by `pnpm preflight` — preflight's final
 * TRUNCATE would wipe your demo data.
 *
 * Database: uses DATABASE_URL directly. The original spec (§6.2) called for
 * PREFLIGHT_DATABASE_URL on a separate Neon branch, but that branch has not
 * been provisioned for Fase 1 (deferred to F2 per session-1 handoff). For
 * Fase 1, preflight and tests/demo share the same DB; the final TRUNCATE is
 * mandatory to leave the DB in a clean state regardless of outcome.
 */

import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Load .env.local manually (pure Node fs — same approach as scripts/seed.ts
// and tests/setup.ts; project deliberately avoids `dotenv` for supply chain
// reasons — see commit 62035f0). Must run BEFORE `import('@prisma/client')`
// so DATABASE_URL is set when PrismaClient resolves.
function loadEnvLocal(): void {
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
    // .env.local optional.
  }
}
loadEnvLocal();

import { PrismaClient, type Chain, type FileType } from '@prisma/client';
import { sorianaParser } from '../core/parsers/soriana';
import { chedrauiParser } from '../core/parsers/chedraui';
import { amazonVentasParser } from '../core/parsers/amazon-ventas';
import { amazonInvParser } from '../core/parsers/amazon-inv';
import type { PortalParser } from '../core/parsers/types';
import { normalize } from '../core/normalizer';
import {
  getDashboardKpis,
  getSalesTrend,
  getSalesByChainForPeriod,
  getInventorySemaforo,
  getTopSkusByChain,
  getDaysOfInventoryBySku,
} from '../core/kpis/queries';
import { main as runSeed, DEMO_USER_EMAIL, DEMO_CLIENT_NAME } from './seed';

const SAMPLES_DIR = resolve(__dirname, '../docs/specs/viks-data/samples');

type PreflightUpload = {
  chain: Chain;
  fileType: FileType;
  file: string;
  parser: PortalParser;
};

// H2 migration: switched from *-sample.xlsx (synthetic, ~60 rows total) to
// *-real.xlsx (VIKS production extracts, ~3,200 rows total). Rationale:
//   • Exercises the full pipeline at demo-day scale, end-to-end.
//   • Surfaces perf regressions before they bite live on stage.
//   • Validates the batched normalizer (H2) against realistic row volumes.
// The *-sample.xlsx fixtures stay in the tree for parser unit tests
// (tests/parsers/*.test.ts), which assert exact row-by-row expected output
// against deterministic small inputs.
// Note exact filename casing: Chedraui-real.xlsx has a capital C.
const UPLOADS: PreflightUpload[] = [
  { chain: 'SORIANA', fileType: 'MIXED', file: 'soriana-real.xlsx', parser: sorianaParser },
  { chain: 'CHEDRAUI', fileType: 'MIXED', file: 'Chedraui-real.xlsx', parser: chedrauiParser },
  { chain: 'AMAZON', fileType: 'VENTAS', file: 'amazon-ventas-real.xlsx', parser: amazonVentasParser },
  { chain: 'AMAZON', fileType: 'INVENTARIO', file: 'amazon-inv-real.xlsx', parser: amazonInvParser },
];

function banner(): void {
  const line = '═'.repeat(72);
  console.log(`\n${line}`);
  console.log('  OneTable PRE-FLIGHT — end-to-end pipeline validation (S11)');
  console.log(line);
  console.log('  ⚠ DESTRUCTIVE: this script TRUNCATEs the DB at start and end.');
  console.log('  ⚠ If you need the demo seed afterwards, run: pnpm db:seed');
  console.log('  ⚠ Uses DATABASE_URL directly (no PREFLIGHT_DATABASE_URL in F1).');
  console.log(`${line}\n`);
}

function phase(n: number, title: string): void {
  console.log(`\n=== Phase ${n}: ${title} ===`);
}

async function truncateAll(db: PrismaClient): Promise<void> {
  // Same statement seed.ts uses — single source of truth for "wipe everything".
  await db.$executeRawUnsafe(`
    TRUNCATE TABLE "SelloutData", "UnmappedProduct", "Upload",
                   "ProductMapping", "Product", "PortalCredential",
                   "Client", "User"
    RESTART IDENTITY CASCADE;
  `);
}

async function main(): Promise<void> {
  banner();
  const startedAt = Date.now();
  const db = new PrismaClient();

  // ── Phase 0 already done by banner() ─────────────────────────────────────
  try {
    // ── Phase 1 — Initial TRUNCATE (defensive idempotency) ────────────────
    phase(1, 'Initial TRUNCATE (defensive idempotency)');
    await truncateAll(db);
    console.log('[preflight] DB wiped.');

    // ── Phase 2 — Seed ────────────────────────────────────────────────────
    phase(2, 'Seed (user + client + catalog + portal credentials)');
    await runSeed(db); // shares this script's PrismaClient — no second pool.

    const client = await db.client.findFirstOrThrow({ where: { name: DEMO_CLIENT_NAME } });
    const user = await db.user.findFirstOrThrow({ where: { email: DEMO_USER_EMAIL } });
    const mappings = await db.productMapping.findMany({ where: { clientId: client.id } });
    const lookup = new Map(mappings.map(m => [`${m.chain}:${m.portalString}`, m.productId]));
    console.log(
      `[preflight] Seed loaded: clientId=${client.id.slice(0, 12)}… userId=${user.id.slice(0, 12)}… mappings=${mappings.length}`,
    );

    // ── Phase 3 — Parse 4 xlsx fixtures ───────────────────────────────────
    phase(3, 'Parse 4 xlsx fixtures');
    const parsedByFile: Array<{ upload: PreflightUpload; parsed: Awaited<ReturnType<PortalParser['parse']>>; buffer: Buffer }> = [];
    for (const u of UPLOADS) {
      const buf = await readFile(resolve(SAMPLES_DIR, u.file));
      const parsed = await u.parser.parse({ buffer: buf, fileType: u.fileType, originalFilename: u.file });
      if (parsed.rows.length === 0) {
        throw new Error(`Parser for ${u.file} returned 0 rows — fixture or parser regression.`);
      }
      console.log(
        `[preflight] ✓ ${u.file}: ${parsed.rows.length} rows, ${parsed.warnings.length} warnings`,
      );
      parsedByFile.push({ upload: u, parsed, buffer: buf });
    }

    // ── Phase 4 — Normalize each parsed result ────────────────────────────
    phase(4, 'Normalize each parsed result (UPSERT into SelloutData)');
    const normalizeStats: Array<{ file: string; inserted: number; updated: number; unmapped: number; elapsedMs: number }> = [];
    for (const { upload: u, parsed, buffer } of parsedByFile) {
      // One Upload row per file, ad-hoc — preflight isn't testing the upload
      // pipeline UX, just the normalize contract.
      const uploadRow = await db.upload.create({
        data: {
          clientId: client.id,
          userId: user.id,
          chain: u.chain,
          fileType: u.fileType,
          originalFilename: u.file,
          fileHash: parsed.metadata.fileHash,
          fileSizeBytes: buffer.length,
          status: 'PENDING',
        },
      });
      const t0 = Date.now();
      const stats = await normalize(
        {
          clientId: client.id,
          userId: user.id,
          uploadId: uploadRow.id,
          parserResult: parsed,
          mappingLookup: (chain, portalString) => lookup.get(`${chain}:${portalString}`) ?? null,
        },
        db,
      );
      const elapsedMs = Date.now() - t0;
      console.log(
        `[preflight] ✓ ${u.file}: inserted=${stats.rowsInserted} updated=${stats.rowsUpdated} ` +
          `unmapped=${stats.rowsUnmapped} newUnmapped=${stats.newUnmappedProducts} ` +
          `elapsed=${elapsedMs}ms`,
      );
      normalizeStats.push({
        file: u.file,
        inserted: stats.rowsInserted,
        updated: stats.rowsUpdated,
        unmapped: stats.rowsUnmapped,
        elapsedMs,
      });
    }

    const selloutCount = await db.selloutData.count({ where: { clientId: client.id } });
    const unmappedCount = await db.unmappedProduct.count({ where: { clientId: client.id } });
    console.log(
      `[preflight] DB state after normalize: SelloutData=${selloutCount}, UnmappedProduct=${unmappedCount}`,
    );
    if (selloutCount === 0) {
      throw new Error('SelloutData is empty after normalize — normalizer contract violation.');
    }

    // ── Phase 5 — KPI queries ─────────────────────────────────────────────
    phase(5, 'KPI queries (6 functions)');
    // Pick the period from the actual data. Soriana sample is the largest;
    // its first row's period is a stable anchor across all parsers.
    const sorianaParsed = parsedByFile.find(p => p.upload.chain === 'SORIANA')!.parsed;
    const periodYear = sorianaParsed.rows[0].periodYear;
    const periodMonth = sorianaParsed.rows[0].periodMonth;
    console.log(`[preflight] Anchoring KPIs to period ${periodYear}-${String(periodMonth).padStart(2, '0')}`);

    const baseParams = { clientId: client.id, userId: user.id };
    const periodParams = { ...baseParams, periodYear, periodMonth };

    const kpis = await getDashboardKpis(db, periodParams);
    console.log(
      `[preflight] getDashboardKpis: salesAmountMxn=${kpis.salesAmountMxn.toFixed(2)} ` +
        `salesUnits=${kpis.salesUnits} variationPct=${kpis.variationPct === null ? 'null' : kpis.variationPct.toFixed(2) + '%'} ` +
        `activeAlertsSkuCount=${kpis.activeAlertsSkuCount}`,
    );
    if (kpis.salesAmountMxn === 0 && kpis.salesUnits === 0) {
      throw new Error('getDashboardKpis returned all-zero sales — KPI query or period mismatch.');
    }

    const trend = await getSalesTrend(db, { ...baseParams, monthsBack: 6 });
    console.log(`[preflight] getSalesTrend(monthsBack=6): ${trend.length} entries`);
    if (trend.length === 0) throw new Error('getSalesTrend returned 0 entries — query regression.');

    const byChain = await getSalesByChainForPeriod(db, periodParams);
    console.log(
      `[preflight] getSalesByChainForPeriod: ${byChain.length} entries [${byChain.map(c => c.chain).join(', ')}]`,
    );
    if (byChain.length === 0) throw new Error('getSalesByChainForPeriod returned 0 entries.');

    const semaforo = await getInventorySemaforo(db, periodParams);
    console.log(`[preflight] getInventorySemaforo: ${semaforo.length} entries`);
    if (semaforo.length === 0) throw new Error('getInventorySemaforo returned 0 entries.');

    const topSkus = await getTopSkusByChain(db, { ...periodParams, limit: 5 });
    console.log(`[preflight] getTopSkusByChain(limit=5): ${topSkus.length} entries`);
    if (topSkus.length === 0) throw new Error('getTopSkusByChain returned 0 entries.');

    const daysInv = await getDaysOfInventoryBySku(db, periodParams);
    console.log(`[preflight] getDaysOfInventoryBySku: ${daysInv.length} entries`);
    if (daysInv.length === 0) throw new Error('getDaysOfInventoryBySku returned 0 entries.');

    // ── Phase 6 — Alert classification spot check ─────────────────────────
    phase(6, 'Alert classification spot check');
    const alertDistribution: Record<string, number> = {};
    for (const row of semaforo) {
      alertDistribution[row.alert] = (alertDistribution[row.alert] ?? 0) + 1;
    }
    console.log(`[preflight] Alert distribution: ${JSON.stringify(alertDistribution)}`);

    const nonOkNonSinDatos = semaforo.filter(r => r.alert !== 'OK' && r.alert !== 'SIN_DATOS');
    if (nonOkNonSinDatos.length === 0) {
      console.warn(
        '[preflight] ⚠ SOFT-WARNING: zero rows classified outside {OK, SIN_DATOS}. ' +
          'The real fixture data may legitimately have no risky inventory — not a fail, ' +
          'but the demo will not visually showcase active alerts.',
      );
    } else {
      const sample = nonOkNonSinDatos[0];
      console.log(
        `[preflight] ✓ Found ${nonOkNonSinDatos.length} non-OK/non-SIN_DATOS rows. ` +
          `Sample: ${sample.productName} / ${sample.chain} → ${sample.alert}`,
      );
    }

    // ── Phase 7 — Structured summary ──────────────────────────────────────
    phase(7, 'Structured summary');
    const elapsedMs = Date.now() - startedAt;
    console.log('  Parsed rows per file:');
    for (const p of parsedByFile) console.log(`    ${p.upload.file}: ${p.parsed.rows.length}`);
    console.log('  Normalize stats:');
    for (const s of normalizeStats) {
      console.log(
        `    ${s.file}: inserted=${s.inserted} updated=${s.updated} unmapped=${s.unmapped} elapsed=${s.elapsedMs}ms`,
      );
    }
    console.log(`  SelloutData total: ${selloutCount}`);
    console.log(`  UnmappedProduct total: ${unmappedCount}`);
    console.log(`  KPI period: ${periodYear}-${String(periodMonth).padStart(2, '0')}`);
    console.log(`  KPI salesAmountMxn: ${kpis.salesAmountMxn.toFixed(2)}`);
    console.log(`  KPI salesUnits: ${kpis.salesUnits}`);
    console.log(`  KPI activeAlertsSkuCount: ${kpis.activeAlertsSkuCount}`);
    console.log(`  Alert distribution: ${JSON.stringify(alertDistribution)}`);
    console.log(`  Total elapsed: ${elapsedMs}ms`);
    if (elapsedMs > 60_000) {
      console.warn(`[preflight] ⚠ SOFT-WARNING: elapsed > 60s (${elapsedMs}ms). Check Neon latency.`);
    }

    console.log('\n[preflight] ✅ PASSED');
  } catch (err) {
    console.error('\n[preflight] ❌ FAILED');
    console.error(err);
    process.exitCode = 1;
  } finally {
    // ── Phase 8 — Final TRUNCATE (mandatory cleanup) ──────────────────────
    phase(8, 'Final TRUNCATE (cleanup, runs regardless of outcome)');
    try {
      await truncateAll(db);
      console.log('[preflight] DB wiped. Run `pnpm db:seed` to repopulate for demo.');
    } catch (cleanupErr) {
      console.error('[preflight] ❌ Cleanup TRUNCATE failed:', cleanupErr);
      process.exitCode = 1;
    }
    await db.$disconnect();
  }
}

main();
