import { describe, it, expect } from 'vitest';
import { getParser } from '@/core/parsers/registry';
import { sorianaParser } from '@/core/parsers/soriana';
import { chedrauiParser } from '@/core/parsers/chedraui';
import { amazonVentasParser } from '@/core/parsers/amazon-ventas';
import { amazonInvParser } from '@/core/parsers/amazon-inv';

describe('getParser', () => {
  it('returns the right parser for each registered (chain, fileType)', () => {
    expect(getParser('SORIANA', 'MIXED')).toBe(sorianaParser);
    expect(getParser('CHEDRAUI', 'MIXED')).toBe(chedrauiParser);
    expect(getParser('AMAZON', 'VENTAS')).toBe(amazonVentasParser);
    expect(getParser('AMAZON', 'INVENTARIO')).toBe(amazonInvParser);
  });

  it('returns null for an unregistered (chain, fileType)', () => {
    // HEB / AL_SUPER / LA_COMER parsers are dropped in B6 — all three must
    // return null today so this test fails loudly if one is half-registered.
    expect(getParser('HEB', 'MIXED')).toBeNull();
    expect(getParser('AL_SUPER', 'MIXED')).toBeNull();
    expect(getParser('LA_COMER', 'MIXED')).toBeNull();
    // Registered chain, wrong fileType also misses.
    expect(getParser('AMAZON', 'MIXED')).toBeNull();
    expect(getParser('SORIANA', 'VENTAS')).toBeNull();
  });
});
