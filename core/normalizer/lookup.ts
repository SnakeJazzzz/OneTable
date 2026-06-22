import type { Chain, MappingStatus } from '@prisma/client';
import type { MappingLookup, MappingLookupResult } from './types';

export type MappingRow = {
  chain: Chain;
  portalString: string;
  productId: string;
  status: MappingStatus;
};

// Build the §8.3 read-side lookup from a flat list of ProductMapping rows.
// Grouping rule per (chain, portalString):
//   - any CONFLICTED rows present → conflict (candidateIds = the conflicted ids)
//   - else exactly one non-conflicted row → mapped
//   - else absent → unmapped
// A key never holds both a non-conflicted and a conflicted row at the same time:
// the D3 detector converts the existing row to CONFLICTED before inserting the
// rival, so a conflicted key has ONLY conflicted rows.
export function buildMappingLookup(rows: MappingRow[]): MappingLookup {
  const byKey = new Map<string, MappingRow[]>();
  for (const r of rows) {
    // Safe delimiter: Chain is a closed Prisma enum whose values contain no `:`,
    // so the prefix is always colon-free and the key is unambiguous even when
    // portalString itself contains colons. Revisit if a colon-bearing chain is added.
    const key = `${r.chain}:${r.portalString}`;
    const list = byKey.get(key);
    if (list) list.push(r);
    else byKey.set(key, [r]);
  }

  return (chain: Chain, portalString: string): MappingLookupResult => {
    const list = byKey.get(`${chain}:${portalString}`);
    if (!list || list.length === 0) return { kind: 'unmapped' };
    const conflicted = list.filter((r) => r.status === 'CONFLICTED');
    if (conflicted.length > 0) {
      return { kind: 'conflict', candidateIds: conflicted.map((r) => r.productId) };
    }
    return { kind: 'mapped', productId: list[0].productId };
  };
}
