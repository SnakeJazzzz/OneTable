import { describe, it, expect } from 'vitest';
import { parsePriceInput, DECIMAL_12_2_MAX_EXCLUSIVE } from '@/lib/prices';

// Contract tests for the shared price parser (B5-3 items A1/A2). This is the
// single parser behind parametros/skus POST + PATCH and price-overrides PUT;
// route-level semantics of `empty` (omit vs clear) are the routes' own.
describe('parsePriceInput', () => {
  it('accepts 0, 1 and 2 decimals and returns the trimmed canonical string', () => {
    expect(parsePriceInput('10')).toEqual({ kind: 'value', value: '10' });
    expect(parsePriceInput('10.5')).toEqual({ kind: 'value', value: '10.5' });
    expect(parsePriceInput('10.55')).toEqual({ kind: 'value', value: '10.55' });
    expect(parsePriceInput('  10.55  ')).toEqual({ kind: 'value', value: '10.55' });
    expect(parsePriceInput('0')).toEqual({ kind: 'value', value: '0' });
  });

  it('rejects 3+ decimals as invalid (B5-3 A2: no silent numeric(12,2) rounding)', () => {
    expect(parsePriceInput('10.999')).toEqual({ kind: 'invalid' });
    expect(parsePriceInput('0.001')).toEqual({ kind: 'invalid' });
  });

  it('rejects "9999999999.995" (pin of the ex-overflow: passed the bound, rounded past it)', () => {
    expect(parsePriceInput('9999999999.995')).toEqual({ kind: 'invalid' });
  });

  it('rejects values at or above the Decimal(12,2) upper bound', () => {
    expect(parsePriceInput('10000000000')).toEqual({ kind: 'invalid' });
    expect(parsePriceInput(String(DECIMAL_12_2_MAX_EXCLUSIVE))).toEqual({ kind: 'invalid' });
    expect(parsePriceInput('10000000000.01')).toEqual({ kind: 'invalid' });
    // Just below the bound is fine.
    expect(parsePriceInput('9999999999.99')).toEqual({ kind: 'value', value: '9999999999.99' });
  });

  it('maps null / undefined / empty / whitespace-only to empty', () => {
    expect(parsePriceInput(null)).toEqual({ kind: 'empty' });
    expect(parsePriceInput(undefined)).toEqual({ kind: 'empty' });
    expect(parsePriceInput('')).toEqual({ kind: 'empty' });
    expect(parsePriceInput('   ')).toEqual({ kind: 'empty' });
  });

  it('coerces a valid non-string number to its canonical string', () => {
    expect(parsePriceInput(12.34)).toEqual({ kind: 'value', value: '12.34' });
    expect(parsePriceInput(80)).toEqual({ kind: 'value', value: '80' });
  });

  it('rejects negative and non-numeric inputs', () => {
    expect(parsePriceInput('-5')).toEqual({ kind: 'invalid' });
    expect(parsePriceInput(-5)).toEqual({ kind: 'invalid' });
    expect(parsePriceInput('abc')).toEqual({ kind: 'invalid' });
    expect(parsePriceInput('1,000')).toEqual({ kind: 'invalid' });
    expect(parsePriceInput('1e3')).toEqual({ kind: 'invalid' });
    expect(parsePriceInput({})).toEqual({ kind: 'invalid' });
  });
});
