/**
 * lib/prices.ts — shared price-input validation for API routes (B5-2).
 *
 * The regex and the Decimal(12,2) bound are copied VERBATIM from the two
 * module-local copies in app/api/parametros/skus/route.ts and
 * app/api/parametros/skus/[id]/route.ts (byte-compatible on purpose), so a
 * future unification of those copies onto this helper is a mechanical no-op.
 * Those two local copies are intentionally NOT touched in B5-2 (blast radius);
 * the unification is tracked in the followups ledger.
 *
 * Known, inherited behavior (ledger B-2, document-or-decide): the regex accepts
 * unlimited decimals and Postgres silently rounds to 2 in numeric(12,2)
 * ("10.999" → 11.00 with no error). Same as parametros — do not "fix" here.
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
  if (!/^\d+(\.\d+)?$/.test(s)) return { kind: 'invalid' };
  if (Number(s) >= DECIMAL_12_2_MAX_EXCLUSIVE) return { kind: 'invalid' };
  return { kind: 'value', value: s };
}
