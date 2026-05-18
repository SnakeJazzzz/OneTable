import type { Chain } from '@prisma/client';
import type { ParserResult } from '../parsers/types';

export type MappingLookup = (chain: Chain, portalString: string) => string | null;

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
  newUnmappedProducts: number;
  warnings: string[];
};
