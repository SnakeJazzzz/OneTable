import { describe, it, expect } from 'vitest';
import { isCodeLike, isMostlyCodes } from '@/core/fuzzy/code-detector';

describe('isCodeLike', () => {
  it.each([
    ['B07XYZ1234', true], // ASIN: 10-char uppercase alphanumeric
    ['7501234567890', true], // EAN-13: 13 digits
    ['750123456789', true], // EAN-12: 12 digits
    ['Carne Seca Original', false],
    ['86g', false],
    ['SHORT', false], // not 10 chars, not 12-14 digits
  ])('%s → %s', (s, expected) => {
    expect(isCodeLike(s)).toBe(expected);
  });
});

describe('isMostlyCodes', () => {
  it('true when ≥70% of the column is code-like', () => {
    expect(isMostlyCodes(['B07XYZ1234', 'B07AAA1111', 'B07BBB2222', 'Some Name'])).toBe(true);
  });

  it('false for a column of product names', () => {
    expect(isMostlyCodes(['Carne Seca Original', 'Chilli Lime 86g', 'Mango 20g'])).toBe(false);
  });

  it('false for an empty column', () => {
    expect(isMostlyCodes([])).toBe(false);
  });
});
