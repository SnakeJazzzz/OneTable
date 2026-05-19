import type { Chain, FileType } from '@prisma/client';

export type ParsedRow = {
  periodYear: number;
  periodMonth: number;
  periodDate?: Date;
  portalRawProduct: string;
  storeId: string | null;
  storeName: string | null;
  storeFormat: string | null;
  salesUnits?: number;
  salesUnitsEstimated?: boolean;
  salesAmountMxn?: number;
  purchasesUnits?: number;
  purchasesAmountMxn?: number;
  inventoryUnits?: number;
  inventoryAmountCostMxn?: number;
  inventoryAmountPriceMxn?: number;
  daysOfInventory?: number;
};

export type ParserMetadata = {
  chain: Chain;
  fileType: FileType;
  originalFilename: string;
  fileHash: string;        // sha256 hex
  fileSizeBytes: number;
  rowCount: number;
};

export type ParserWarning = {
  rowIndex: number;        // 1-based excluding header
  field?: string;
  message: string;
};

export type ParserResult = {
  metadata: ParserMetadata;
  rows: ParsedRow[];
  warnings: ParserWarning[];
};

export interface PortalParser {
  readonly chain: Chain;
  readonly supportedFileTypes: readonly FileType[];

  parse(input: {
    buffer: Buffer;
    fileType: FileType;
    originalFilename: string;
  }): Promise<ParserResult>;
}
