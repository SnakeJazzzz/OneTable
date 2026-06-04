import type { Chain, FileType } from '@prisma/client';
import type { PortalParser } from './types';
import { sorianaParser } from './soriana';
import { chedrauiParser } from './chedraui';
import { amazonVentasParser } from './amazon-ventas';
import { amazonInvParser } from './amazon-inv';

// Keyed by `${chain}:${fileType}`. HEB / AL_SUPER / LA_COMER are added in B6
// once real sample files exist; today they intentionally return null.
const REGISTRY: Record<string, PortalParser> = {
  'SORIANA:MIXED': sorianaParser,
  'CHEDRAUI:MIXED': chedrauiParser,
  'AMAZON:VENTAS': amazonVentasParser,
  'AMAZON:INVENTARIO': amazonInvParser,
};

export function getParser(chain: Chain, fileType: FileType): PortalParser | null {
  return REGISTRY[`${chain}:${fileType}`] ?? null;
}
