// Matches an integer gram weight: digits + optional space + a gram unit.
// Covers "86g", "100 GRAMOS", "28GR", "20 g". Case-insensitive.
const WEIGHT_RE = /\b(\d{1,4})\s*(g|gr|grs|gramos?)\b/i;

export function extractWeightGrams(s: string): number | null {
  const m = s.match(WEIGHT_RE);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

// Multiplicative guard applied on top of the token-set ratio. Returns 1 (no
// penalty) when a weight can't be compared — either side missing, or equal.
// Otherwise scales down by the relative gram difference, clamped at 0. This is
// what keeps "86g" from matching "20g" (penalty ≈ 0.23) so the wrong size
// falls into the LOW band even though the words are identical (§5.3 / §14).
export function weightPenalty(a: string, b: string): number {
  const wa = extractWeightGrams(a);
  const wb = extractWeightGrams(b);
  if (wa === null || wb === null) return 1;
  if (wa === wb) return 1;
  return Math.max(0, 1 - Math.abs(wa - wb) / Math.max(wa, wb));
}
