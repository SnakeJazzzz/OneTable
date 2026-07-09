import type { Chain } from '@prisma/client';
import type { ParserResult } from '../parsers/types';

// §8.3 — the lookup READS pre-existing mapping state. CONFLICTED rows resolve
// to `conflict` (productId stays NULL, same KPI treatment as unmapped — §8.4).
// The lookup does NOT detect new conflicts; detection is the mapping-UI
// write-path (D3, core/normalizer/resolve.ts).
export type MappingLookupResult =
  | { kind: 'mapped'; productId: string }
  | { kind: 'unmapped' }
  | { kind: 'conflict'; candidateIds: string[] };

export type MappingLookup = (chain: Chain, portalString: string) => MappingLookupResult;

export type NormalizationInput = {
  clientId: string;
  userId: string;
  uploadId: string;
  parserResult: ParserResult;
  mappingLookup: MappingLookup;
};

export type NormalizationStats = {
  rowsTotal: number;
  rowsInserted: number;
  rowsUpdated: number;
  rowsUnmapped: number;
  rowsConflicted: number;
  newUnmappedProducts: number;
  warnings: string[];
};
