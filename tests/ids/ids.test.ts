import { describe, it, expect } from 'vitest';
import { makeCuid } from '@/core/ids';

describe('makeCuid', () => {
  it('returns a 25-char string matching /^c[0-9a-f]{24}$/', () => {
    const id = makeCuid();
    expect(id).toHaveLength(25);
    expect(id).toMatch(/^c[0-9a-f]{24}$/);
  });

  it('returns a different value on each call', () => {
    const a = makeCuid();
    const b = makeCuid();
    expect(a).not.toBe(b);
  });
});
