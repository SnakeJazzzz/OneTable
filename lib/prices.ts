/**
 * lib/prices.ts — shared price-input validation for API routes.
 *
 * Since B5-3 (item A1) this is the SINGLE parser behind all three price
 * routes: parametros/skus POST, parametros/skus/[id] PATCH, and
 * portales/price-overrides PUT. Each route maps `empty` onto its own
 * semantics (omit on create, clear on PATCH) via a local adapter.
 *
 * Decimals are capped at 2 (B5-3 item A2, decided from the ledger's
 * document-or-decide): the old `\.\d+` regex let Postgres silently round
 * numeric(12,2) inputs ("10.999" → 11.00) and let "9999999999.995" pass the
 * upper bound only to overflow after rounding (P2000 → raw 500). Both are now
 * a clean 400 at the route.
 *
 * DELIBERATE DIVERGENCE: the Excel importer (core/parameters/import.ts
 * parsePrice) still accepts unlimited decimals — core/ is out of scope for
 * this sweep. UI-strict vs import-permissive is documented, not resolved.
 */

// Upper bound for a Decimal(12,2) column (10 integer digits): a value >= 10^10
// passes the regex but overflows the column, making Prisma throw P2000/P2020 —
// which route catch blocks don't handle → generic 500. Reject it here so routes
// return a graceful 400 INVALID_PRICE instead.
export const DECIMAL_12_2_MAX_EXCLUSIVE = 10_000_000_000; // matches core/parameters/import.ts

// Result of parsing an untrusted price value. `empty` covers null/undefined/''
// (and whitespace-only strings); what "empty" MEANS (clear vs omit) is the
// caller's semantic decision, not this helper's.
export type PriceInputResult =
  | { kind: 'empty' }
  | { kind: 'value'; value: string }
  | { kind: 'invalid' };

export function parsePriceInput(raw: unknown): PriceInputResult {
  if (raw === null || raw === undefined || raw === '') return { kind: 'empty' };
  const s = String(raw).trim();
  if (s === '') return { kind: 'empty' };
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return { kind: 'invalid' };
  if (Number(s) >= DECIMAL_12_2_MAX_EXCLUSIVE) return { kind: 'invalid' };
  return { kind: 'value', value: s };
}
