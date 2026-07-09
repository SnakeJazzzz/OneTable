import type { Chain, FileType } from '@prisma/client';

// Canonical list of portal chains, kept in sync with the Prisma `Chain` enum.
// Centralized so the per-route chain parsing does not drift across consumers
// (mappings / conflicts / counts / credentials) when a new chain is enabled.
export const CHAINS = ['SORIANA', 'CHEDRAUI', 'HEB', 'AL_SUPER', 'LA_COMER', 'AMAZON'] as const;

// Narrow an untrusted query/body value to a Chain, or null if it isn't one.
export function parseChain(raw: unknown): Chain | null {
  return CHAINS.includes(raw as Chain) ? (raw as Chain) : null;
}

// Canonical list of file types, kept in sync with the Prisma `FileType` enum.
// Centralized alongside CHAINS so a future enum addition (e.g. a new file
// category) is a known sync point here — not a silent drift in per-route code.
export const FILE_TYPES = ['MIXED', 'VENTAS', 'INVENTARIO'] as const;

// Narrow an untrusted query/body value to a FileType, or null if it isn't one.
export function parseFileType(raw: unknown): FileType | null {
  return FILE_TYPES.includes(raw as FileType) ? (raw as FileType) : null;
}
