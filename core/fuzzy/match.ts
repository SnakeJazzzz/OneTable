import { tokenSetRatio } from './token-set-ratio';
import { weightPenalty } from './weight';

export type FuzzyThresholds = { tHigh: number; tLow: number };
export type FuzzyBand = 'high' | 'medium' | 'low';

// PROVISIONAL — derived effectively from Soriana alone (Amazon is code-skipped
// by the detector §5.4, Chedraui is barely pre-filled, HEB has NO real file in
// the repo until B6). Re-generate with scripts/calibrate-fuzzy.ts when new
// chains get real files. These are a STARTING POINT passed as a parameter; the
// scoring path never hardcodes them. (spec §5.6)
export const PROVISIONAL_FUZZY_THRESHOLDS: FuzzyThresholds = { tHigh: 0.7, tLow: 0.3 };

export type CatalogEntry = { productId: string; nameStandard: string };

export type FuzzySuggestion = {
  productId: string | null;
  nameStandard: string | null;
  score: number;
  band: FuzzyBand;
};

// Combined score: token similarity gated by the weight-penalty guard. A perfect
// word match with a wrong gram size scores low (§14).
export function scoreMatch(a: string, b: string): number {
  return tokenSetRatio(a, b) * weightPenalty(a, b);
}

export function classifyBand(score: number, thresholds: FuzzyThresholds): FuzzyBand {
  if (score >= thresholds.tHigh) return 'high';
  if (score >= thresholds.tLow) return 'medium';
  return 'low';
}

// Best catalog entry for a portal string. Caller decides what to do per band
// (high → CONFIRMED on accept, medium → required review, low → manual). The
// catalog is assumed already filtered to this client; code-based columns are
// skipped upstream via isMostlyCodes (§5.4) before calling this.
export function suggestMatch(
  portalString: string,
  catalog: CatalogEntry[],
  thresholds: FuzzyThresholds,
): FuzzySuggestion {
  let best: CatalogEntry | null = null;
  let bestScore = -1;
  for (const entry of catalog) {
    const s = scoreMatch(portalString, entry.nameStandard);
    if (s > bestScore) {
      bestScore = s;
      best = entry;
    }
  }
  if (best === null) {
    return { productId: null, nameStandard: null, score: 0, band: 'low' };
  }
  return {
    productId: best.productId,
    nameStandard: best.nameStandard,
    score: bestScore,
    band: classifyBand(bestScore, thresholds),
  };
}
