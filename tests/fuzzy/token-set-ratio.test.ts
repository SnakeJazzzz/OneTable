import { describe, it, expect } from 'vitest';
import { tokenize, tokenSetRatio } from '@/core/fuzzy/token-set-ratio';

describe('tokenize', () => {
  it('lowercases, strips punctuation, drops length-1 tokens, dedups', () => {
    expect([...tokenize('Carne Seca, ORIGINAL!! a')].sort()).toEqual([
      'carne',
      'original',
      'seca',
    ]);
  });

  it('keeps alphanumeric weight tokens like 86g', () => {
    expect(tokenize('Chilli Lime 86g').has('86g')).toBe(true);
  });
});

describe('tokenSetRatio', () => {
  it('returns 1 for identical token sets (order/dup-insensitive)', () => {
    expect(tokenSetRatio('carne seca original', 'original seca carne carne')).toBe(1);
  });

  it('returns 0 when either side has no usable tokens', () => {
    expect(tokenSetRatio('', 'carne seca')).toBe(0);
    expect(tokenSetRatio('a', 'carne seca')).toBe(0);
  });

  it('scores partial overlap via Sørensen-Dice', () => {
    // A={carne,seca,lime} B={carne,seca,mango} → 2*2/(3+3)=0.6667
    expect(tokenSetRatio('carne seca lime', 'carne seca mango')).toBeCloseTo(0.6667, 4);
  });
});
