import type { Chain, PrismaClient } from '@prisma/client';
import { isMostlyCodes, suggestMatch, PROVISIONAL_FUZZY_THRESHOLDS, type CatalogEntry, type FuzzySuggestion, type FuzzyThresholds } from './index';

export type SuggestionRow = { portalString: string; suggestion: FuzzySuggestion };
export type SuggestResult = { codeSkip: boolean; suggestions: SuggestionRow[] };

// Pure core: code-detector first (§5.4), else suggestMatch per string.
export function suggestForStrings(strings: string[], catalog: CatalogEntry[], thresholds: FuzzyThresholds): SuggestResult {
  // §5.4: a code column (ASIN/EAN) is never auto-scored — we do NOT run
  // suggestMatch over codes. But the raw strings still have to reach the UI so
  // they can be mapped by hand, so emit one null-suggestion row per string in
  // band 'low' (which routes them through the manual dropdown path, Fix 1). The
  // codeSkip flag is preserved so the UI can render the "columna por código" note.
  if (isMostlyCodes(strings)) {
    return {
      codeSkip: true,
      suggestions: strings.map((portalString) => ({
        portalString,
        suggestion: { productId: null, nameStandard: null, score: 0, band: 'low' as const },
      })),
    };
  }
  return {
    codeSkip: false,
    suggestions: strings.map((portalString) => ({ portalString, suggestion: suggestMatch(portalString, catalog, thresholds) })),
  };
}

// DB-backed orchestration: unmapped queue × catalog for one chain (D1).
export async function buildMappingSuggestions(
  db: PrismaClient,
  args: { clientId: string; chain: Chain },
): Promise<SuggestResult> {
  const [unmapped, products] = await Promise.all([
    db.unmappedProduct.findMany({ where: { clientId: args.clientId, chain: args.chain, resolvedAt: null }, select: { portalString: true } }),
    db.product.findMany({ where: { clientId: args.clientId }, select: { id: true, nameStandard: true } }),
  ]);
  const catalog: CatalogEntry[] = products.map((p) => ({ productId: p.id, nameStandard: p.nameStandard }));
  return suggestForStrings(unmapped.map((u) => u.portalString), catalog, PROVISIONAL_FUZZY_THRESHOLDS);
}
