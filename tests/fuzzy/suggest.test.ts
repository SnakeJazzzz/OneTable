import { describe, it, expect } from 'vitest';
import { suggestForStrings } from '@/core/fuzzy/suggest';
import { PROVISIONAL_FUZZY_THRESHOLDS, type CatalogEntry } from '@/core/fuzzy';

const catalog: CatalogEntry[] = [
  { productId: 'p86', nameStandard: 'Chilli Lime 86g' },
  { productId: 'pmh', nameStandard: 'Mango Habanero 100g' },
];

describe('suggestForStrings', () => {
  it('returns codeSkip=true for a mostly-code column (Amazon ASIN, §5.4)', () => {
    const out = suggestForStrings(['B07XKZJ8H1', 'B08AAA1111', 'B09BBB2222'], catalog, PROVISIONAL_FUZZY_THRESHOLDS);
    expect(out.codeSkip).toBe(true);
    expect(out.suggestions).toEqual([]);
  });

  it('returns per-string band suggestions for a name column', () => {
    const out = suggestForStrings(['CHILLI LIME 86 GR'], catalog, PROVISIONAL_FUZZY_THRESHOLDS);
    expect(out.codeSkip).toBe(false);
    expect(out.suggestions[0].portalString).toBe('CHILLI LIME 86 GR');
    expect(out.suggestions[0].suggestion.productId).toBe('p86');
    expect(out.suggestions[0].suggestion.band).toBe('high'); // canonicalized "86 GR"→"86g" lifts the score
  });

  it('returns an empty result for an empty unmapped queue (characterization)', () => {
    // isMostlyCodes([]) guards length===0 → false; nothing to classify as code,
    // nothing to suggest. Pins the empty-chain path (no unresolved unmapped rows).
    const out = suggestForStrings([], catalog, PROVISIONAL_FUZZY_THRESHOLDS);
    expect(out.codeSkip).toBe(false);
    expect(out.suggestions).toEqual([]);
  });
});
