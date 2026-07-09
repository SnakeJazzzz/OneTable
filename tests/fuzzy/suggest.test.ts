import { describe, it, expect } from 'vitest';
import { suggestForStrings } from '@/core/fuzzy/suggest';
import { PROVISIONAL_FUZZY_THRESHOLDS, type CatalogEntry } from '@/core/fuzzy';

const catalog: CatalogEntry[] = [
  { productId: 'p86', nameStandard: 'Chilli Lime 86g' },
  { productId: 'pmh', nameStandard: 'Mango Habanero 100g' },
];

describe('suggestForStrings', () => {
  it('returns codeSkip=true with one null-suggestion row per code string (Amazon ASIN, §5.4)', () => {
    // §5.4: code columns are never auto-suggested (no fuzzy over ASINs), but the
    // raw strings MUST reach the UI so they can be mapped by hand. codeSkip stays
    // true (drives the "columna por código" note); every row carries a null
    // suggestion in band 'low' so it falls through the manual dropdown path.
    const codes = ['B07XKZJ8H1', 'B08AAA1111', 'B09BBB2222'];
    const out = suggestForStrings(codes, catalog, PROVISIONAL_FUZZY_THRESHOLDS);
    expect(out.codeSkip).toBe(true);
    expect(out.suggestions).toHaveLength(codes.length);
    expect(out.suggestions[0].portalString).toBe('B07XKZJ8H1');
    expect(out.suggestions.map((s) => s.portalString)).toEqual(codes);
    expect(out.suggestions.every((s) => s.suggestion.productId === null)).toBe(true);
    expect(out.suggestions.every((s) => s.suggestion.band === 'low')).toBe(true);
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
