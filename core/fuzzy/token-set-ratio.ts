// Pure string similarity. No Next/Prisma imports — core/ stays portable to
// the Fase 3 Python service. Own implementation (no fuzzy library) per the
// supply-chain protocol.

// Lowercase, replace every non-letter/non-number/non-space with a space, split
// on whitespace, drop length-1 noise tokens, dedup into a Set. \p{L}\p{N} with
// the u flag keeps accented letters (e.g. "jalapeño") and digits (e.g. "86g").
export function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1),
  );
}

// Sørensen-Dice coefficient over the two token sets: (2·|A∩B|) / (|A|+|B|).
// Returns 0 if either set is empty (no basis for comparison).
export function tokenSetRatio(a: string, b: string): number {
  const sa = tokenize(a);
  const sb = tokenize(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let intersection = 0;
  for (const t of sa) if (sb.has(t)) intersection++;
  return (2 * intersection) / (sa.size + sb.size);
}
