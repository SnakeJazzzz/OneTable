// Single production cuid-shaped opaque id generator. No Prisma @default on
// skuCode (spec §4.2), so the TS layer provides ids at every create site:
// catalog seed import, the normalizer UPSERT, and Parámetros SKU CRUD (B3).
import { randomUUID } from 'node:crypto';

export function makeCuid(): string {
  return `c${randomUUID().replace(/-/g, '').slice(0, 24)}`;
}
