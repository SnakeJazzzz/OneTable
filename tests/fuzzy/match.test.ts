import { describe, it, expect } from 'vitest';
import {
  scoreMatch,
  classifyBand,
  suggestMatch,
  PROVISIONAL_FUZZY_THRESHOLDS,
  type CatalogEntry,
} from '@/core/fuzzy/match';

describe('scoreMatch', () => {
  it('is tokenSetRatio × weightPenalty', () => {
    // identical words, identical weight → 1 × 1
    expect(scoreMatch('chilli lime 86g', 'chilli lime 86g')).toBe(1);
  });

  it('demotes the §14 cross-weight case (86g vs 20g)', () => {
    // tokenSetRatio({chilli,lime,86g},{chilli,lime,20g}) = 2*2/6 = 0.6667
    // weightPenalty = 0.2326 → score ≈ 0.1551
    expect(scoreMatch('chilli lime 86g', 'chilli lime 20g')).toBeCloseTo(0.1551, 3);
  });
});

describe('classifyBand', () => {
  const t = { tHigh: 0.7, tLow: 0.3 };
  it.each([
    [0.95, 'high'],
    [0.7, 'high'],
    [0.5, 'medium'],
    [0.3, 'medium'],
    [0.155, 'low'],
    [0, 'low'],
  ])('score=%s → %s', (score, band) => {
    expect(classifyBand(score as number, t)).toBe(band);
  });
});

describe('suggestMatch', () => {
  const catalog: CatalogEntry[] = [
    { productId: 'p86', nameStandard: 'Chilli Lime 86g' },
    { productId: 'p20', nameStandard: 'Chilli Lime 20g' },
    { productId: 'pman', nameStandard: 'Mango Habanero 86g' },
  ];

  it('picks the correct weight variant (86g portal → 86g SKU, high band)', () => {
    const r = suggestMatch('CHILLI LIME 86G', catalog, PROVISIONAL_FUZZY_THRESHOLDS);
    expect(r.productId).toBe('p86');
    expect(r.band).toBe('high');
  });

  it('the wrong-weight twin lands in the LOW band as the runner-up logic', () => {
    // Against a catalog that only has the 20g twin, the 86g portal string is
    // demoted to low (not silently confirmed).
    const r = suggestMatch('CHILLI LIME 86G', [{ productId: 'p20', nameStandard: 'Chilli Lime 20g' }], PROVISIONAL_FUZZY_THRESHOLDS);
    expect(r.productId).toBe('p20');
    expect(r.band).toBe('low');
  });

  it('returns a low/empty suggestion for an empty catalog', () => {
    const r = suggestMatch('anything', [], PROVISIONAL_FUZZY_THRESHOLDS);
    expect(r.productId).toBeNull();
    expect(r.band).toBe('low');
  });
});
