import { describe, it, expect } from 'vitest';
import { classifyAlert } from '@/core/alerts/classify';

describe('classifyAlert', () => {
  it.each([
    // inv=0 → SIN_STOCK regardless of days
    [0, null, 'SIN_STOCK'],
    [0, 5, 'SIN_STOCK'],
    [0, 50, 'SIN_STOCK'],

    // days null (inv != 0) → SIN_DATOS
    [10, null, 'SIN_DATOS'],
    [null, null, 'SIN_DATOS'],

    // days < 7 → CRITICO
    [10, 0, 'CRITICO'],
    [10, 3, 'CRITICO'],
    [10, 6, 'CRITICO'],

    // 7 <= days < 14 → RIESGO
    [10, 7, 'RIESGO'],
    [10, 13, 'RIESGO'],

    // 14 <= days < 21 → ATENCION
    [10, 14, 'ATENCION'],
    [10, 20, 'ATENCION'],

    // 21 <= days <= 60 → OK
    [10, 21, 'OK'],
    [10, 30, 'OK'],
    [10, 60, 'OK'],

    // days > 60 → EXCESO
    [10, 61, 'EXCESO'],
    [10, 1000, 'EXCESO'],
  ])('inv=%s, days=%s → %s', (inv, days, expected) => {
    expect(classifyAlert(inv as number | null, days as number | null)).toBe(expected);
  });
});
