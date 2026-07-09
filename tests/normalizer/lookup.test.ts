import { describe, it, expect } from 'vitest';
import { buildMappingLookup } from '@/core/normalizer/lookup';

describe('buildMappingLookup', () => {
  it('classifies a single CONFIRMED row as mapped', () => {
    const lookup = buildMappingLookup([
      { chain: 'SORIANA', portalString: 'CARNE SECA', productId: 'p1', status: 'CONFIRMED' },
    ]);
    expect(lookup('SORIANA', 'CARNE SECA')).toEqual({ kind: 'mapped', productId: 'p1' });
  });

  it('treats PENDING_REVIEW as mapped (enters KPIs, §3.2.3)', () => {
    const lookup = buildMappingLookup([
      { chain: 'SORIANA', portalString: 'X', productId: 'p2', status: 'PENDING_REVIEW' },
    ]);
    expect(lookup('SORIANA', 'X')).toEqual({ kind: 'mapped', productId: 'p2' });
  });

  it('returns unmapped for an absent key', () => {
    const lookup = buildMappingLookup([]);
    expect(lookup('AMAZON', 'B07XYZ')).toEqual({ kind: 'unmapped' });
  });

  it('returns conflict with all candidate ids when CONFLICTED rows exist', () => {
    const lookup = buildMappingLookup([
      { chain: 'AL_SUPER', portalString: 'CITRUS GINGER', productId: 'pA', status: 'CONFLICTED' },
      { chain: 'AL_SUPER', portalString: 'CITRUS GINGER', productId: 'pB', status: 'CONFLICTED' },
    ]);
    expect(lookup('AL_SUPER', 'CITRUS GINGER')).toEqual({
      kind: 'conflict',
      candidateIds: ['pA', 'pB'],
    });
  });

  it('a CONFLICTED row beside a CONFIRMED one wins → conflict, candidateIds = conflicted only', () => {
    // Pins the §8.3 invariant the builder asserts in its doc comment: if a key
    // ever holds a stale CONFIRMED alongside a CONFLICTED row, the lookup reads
    // `conflict` (productId NULL) and never leaks the confirmed id as a candidate.
    const lookup = buildMappingLookup([
      { chain: 'AL_SUPER', portalString: 'MIX', productId: 'p1', status: 'CONFIRMED' },
      { chain: 'AL_SUPER', portalString: 'MIX', productId: 'p2', status: 'CONFLICTED' },
    ]);
    expect(lookup('AL_SUPER', 'MIX')).toEqual({ kind: 'conflict', candidateIds: ['p2'] });
  });

  it('keys are chain-scoped (same portalString, different chain → independent)', () => {
    const lookup = buildMappingLookup([
      { chain: 'SORIANA', portalString: 'DUP', productId: 'p1', status: 'CONFIRMED' },
    ]);
    expect(lookup('CHEDRAUI', 'DUP')).toEqual({ kind: 'unmapped' });
  });
});
