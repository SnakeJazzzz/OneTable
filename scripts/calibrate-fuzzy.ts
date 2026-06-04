/**
 * scripts/calibrate-fuzzy.ts — derive PROVISIONAL fuzzy cuts (spec §5.6).
 *
 * Reads the catalog (ground truth: each VIKS standard name + its verbatim
 * per-chain portal strings) and each available REAL portal file, parses the
 * portal file via the B1 registry, skips code-like strings (§5.4), scores every
 * remaining portal string against the catalog, and reports:
 *   - a per-row table: portalString | bestMatch | score | correct?
 *   - the score distribution of CORRECT vs INCORRECT best-matches
 *   - a suggested (tHigh, tLow) split
 *
 * ⚠ PROVISIONAL: with Amazon code-skipped and Chedraui barely pre-filled, this
 * runs effectively over Soriana only; HEB has no real file until B6. Treat the
 * output as Soriana-derived, NOT final. Re-run with new chains by adding to
 * REAL_FILES below — no other code change needed.
 *
 * Run: pnpm tsx scripts/calibrate-fuzzy.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as XLSX from 'xlsx';
import type { Chain, FileType } from '@prisma/client';

import { getParser } from '../core/parsers/registry';
import { scoreMatch, isCodeLike, type CatalogEntry } from '../core/fuzzy';

// ---- Parameterization: add a chain here to fold it into calibration ----
type RealFile = { file: string; fileType: FileType; catalogColumn: string };
const REAL_FILES: Partial<Record<Chain, RealFile>> = {
  SORIANA: { file: 'soriana-real.xlsx', fileType: 'MIXED', catalogColumn: 'SORIANA' },
  CHEDRAUI: { file: 'Chedraui-real.xlsx', fileType: 'MIXED', catalogColumn: 'CHEDRAUI' },
  AMAZON: { file: 'amazon-ventas-real.xlsx', fileType: 'VENTAS', catalogColumn: 'AMAZON' },
  // HEB: drop in when the real HEB file arrives in B6 (only samples exist today).
};

const SAMPLES_DIR = resolve(__dirname, '../docs/specs/viks-data/samples');
const CATALOG_FILE = resolve(__dirname, '../docs/specs/viks-data/catalogo-productos.xlsx');
const CATALOG_SHEET = 'Catalogo_Producto';
const STANDARD_COLUMN = 'Producto VIKS';

type GroundTruth = {
  catalog: CatalogEntry[]; // { productId: standardName-as-id, nameStandard }
  // catalogColumn -> (portalString -> standardName)
  byChainColumn: Record<string, Map<string, string>>;
};

function loadGroundTruth(): GroundTruth {
  const wb = XLSX.read(readFileSync(CATALOG_FILE), { type: 'buffer' });
  const sheet = wb.Sheets[CATALOG_SHEET];
  if (!sheet) throw new Error(`Catalog sheet "${CATALOG_SHEET}" not found`);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });

  const catalog: CatalogEntry[] = [];
  const byChainColumn: Record<string, Map<string, string>> = {};
  for (const cfg of Object.values(REAL_FILES)) {
    byChainColumn[cfg!.catalogColumn] = new Map();
  }

  for (const row of rows) {
    const std = String(row[STANDARD_COLUMN] ?? '').trim();
    if (!std) continue;
    catalog.push({ productId: std, nameStandard: std });
    for (const col of Object.keys(byChainColumn)) {
      const v = row[col];
      if (v === null || v === undefined || String(v).trim() === '') continue;
      byChainColumn[col].set(String(v).trim(), std);
    }
  }
  return { catalog, byChainColumn };
}

type ScoredRow = { portalString: string; best: string; score: number; correct: boolean };

async function calibrateChain(
  chain: Chain,
  cfg: RealFile,
  gt: GroundTruth,
): Promise<ScoredRow[]> {
  const parser = getParser(chain, cfg.fileType);
  if (!parser) {
    console.warn(`  no parser for ${chain}/${cfg.fileType} — skipping`);
    return [];
  }
  const buffer = readFileSync(resolve(SAMPLES_DIR, cfg.file));
  const parsed = await parser.parse({ buffer, fileType: cfg.fileType, originalFilename: cfg.file });

  const truthMap = gt.byChainColumn[cfg.catalogColumn] ?? new Map<string, string>();
  const seen = new Set<string>();
  const scored: ScoredRow[] = [];

  for (const r of parsed.rows) {
    const portalString = r.portalRawProduct.trim();
    if (!portalString || seen.has(portalString)) continue;
    seen.add(portalString);
    if (isCodeLike(portalString)) continue; // §5.4: code columns skip fuzzy

    let best = '';
    let bestScore = -1;
    for (const entry of gt.catalog) {
      const s = scoreMatch(portalString, entry.nameStandard);
      if (s > bestScore) {
        bestScore = s;
        best = entry.nameStandard;
      }
    }
    const expected = truthMap.get(portalString) ?? null;
    scored.push({
      portalString,
      best,
      score: bestScore,
      // Only judged when ground truth exists for this portal string.
      correct: expected !== null && best === expected,
    });
  }
  return scored;
}

function suggestCuts(rows: ScoredRow[]): { tHigh: number; tLow: number } {
  const judged = rows.filter((r) => r.score >= 0);
  const correct = judged.filter((r) => r.correct).map((r) => r.score).sort((a, b) => a - b);
  const incorrect = judged.filter((r) => !r.correct).map((r) => r.score).sort((a, b) => a - b);
  // tHigh: a score at/above which correct dominates — use the 10th percentile of
  // correct scores. tLow: the 90th percentile of incorrect scores. Both are
  // heuristic starting points for a human to eyeball against the table.
  const pct = (xs: number[], p: number): number =>
    xs.length === 0 ? NaN : xs[Math.min(xs.length - 1, Math.floor(p * xs.length))];
  return {
    tHigh: Number(pct(correct, 0.1).toFixed(3)),
    tLow: Number(pct(incorrect, 0.9).toFixed(3)),
  };
}

async function main(): Promise<void> {
  const gt = loadGroundTruth();
  const all: ScoredRow[] = [];

  for (const [chain, cfg] of Object.entries(REAL_FILES) as Array<[Chain, RealFile]>) {
    console.log(`\n=== ${chain} (${cfg.file}) ===`);
    const scored = await calibrateChain(chain, cfg, gt);
    const judged = scored.filter((r) => r.score >= 0);
    for (const r of judged.slice(0, 40)) {
      console.log(
        `  ${r.score.toFixed(3)}  ${r.correct ? 'OK ' : 'XX '} ${r.portalString.slice(0, 40).padEnd(40)} -> ${r.best.slice(0, 40)}`,
      );
    }
    console.log(`  rows scored: ${judged.length}`);
    all.push(...scored);
  }

  const cuts = suggestCuts(all);
  console.log('\n=== SUGGESTED PROVISIONAL CUTS (Soriana-derived, NOT final) ===');
  console.log(`  tHigh ≈ ${cuts.tHigh}   tLow ≈ ${cuts.tLow}`);
  console.log('  Eyeball these against the table above before adopting. Re-run');
  console.log('  with new chains via the REAL_FILES map. (spec §5.6)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
