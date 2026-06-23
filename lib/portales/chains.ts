import type { Chain } from '@prisma/client';

// Canonical list of portal chains, kept in sync with the Prisma `Chain` enum.
// Centralized so the per-route chain parsing does not drift across consumers
// (mappings / conflicts / counts / credentials) when a new chain is enabled.
export const CHAINS = ['SORIANA', 'CHEDRAUI', 'HEB', 'AL_SUPER', 'LA_COMER', 'AMAZON'] as const;

// Narrow an untrusted query/body value to a Chain, or null if it isn't one.
export function parseChain(raw: unknown): Chain | null {
  return CHAINS.includes(raw as Chain) ? (raw as Chain) : null;
}
