import { describe, it, expect } from 'vitest';
import { extractWeightGrams, weightPenalty } from '@/core/fuzzy/weight';

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
