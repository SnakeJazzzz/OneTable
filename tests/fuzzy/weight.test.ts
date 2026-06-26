import { describe, it, expect } from 'vitest';
import { extractWeightGrams, weightPenalty, canonicalizeWeights } from '@/core/fuzzy/weight';

describe('extractWeightGrams', () => {
  it.each([
    ['Chilli Lime 86g', 86],
    ['CARNE SECA 100 GRAMOS', 100],
    ['Original 28GR', 28],
    ['Mango 20 g', 20],
    ['No weight here', null],
  ])('%s → %s', (s, expected) => {
    expect(extractWeightGrams(s)).toBe(expected);
  });
});

describe('weightPenalty', () => {
  it('is 1 when neither side has a weight', () => {
    expect(weightPenalty('carne seca', 'carne original')).toBe(1);
  });

  it('is 1 when one side has no weight (cannot penalize)', () => {
    expect(weightPenalty('carne 86g', 'carne seca')).toBe(1);
  });

  it('is 1 when both weights are equal', () => {
    expect(weightPenalty('lime 86g', 'lime 86 g')).toBe(1);
  });

  it('demotes cross-weight matches proportionally', () => {
    // |86-20|/86 = 0.767 → penalty 0.233
    expect(weightPenalty('lime 86g', 'lime 20g')).toBeCloseTo(0.2326, 3);
  });
});

describe('canonicalizeWeights', () => {
  it.each([
    ['CARNE SECA 86 GR', 'CARNE SECA 86g'],
    ['Chilli 100 GRAMOS', 'Chilli 100g'],
    ['Original 28GR', 'Original 28g'],
    ['Mango 20 g', 'Mango 20g'],
    ['No weight', 'No weight'],
  ])('%s → %s', (input, expected) => {
    expect(canonicalizeWeights(input)).toBe(expected);
  });
});
