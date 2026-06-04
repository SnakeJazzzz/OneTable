// ASIN: exactly 10 uppercase letters/digits (Amazon). EAN/UPC: 12-14 digits.
// Kept strict (uppercase-only ASIN) so a lowercase 10-letter product word does
// not register as a code. False positives on a single cell don't matter — the
// skip decision is made at the column level by isMostlyCodes.
const ASIN_RE = /^[A-Z0-9]{10}$/;
const EAN_RE = /^\d{12,14}$/;

export function isCodeLike(s: string): boolean {
  const t = s.trim();
  return ASIN_RE.test(t) || EAN_RE.test(t);
}

// Column-level decision: is this portal column code-based (→ skip fuzzy, §5.4)?
// Default threshold 0.7 tolerates a few stray human-entered names in an
// otherwise code column. Empty column → false (nothing to skip).
export function isMostlyCodes(strings: string[], threshold = 0.7): boolean {
  if (strings.length === 0) return false;
  const codeCount = strings.filter(isCodeLike).length;
  return codeCount / strings.length >= threshold;
}
