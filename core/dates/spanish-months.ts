const SHORT_MAP: Record<string, number> = {
  Ene: 1, Feb: 2, Mar: 3, Abr: 4, May: 5, Jun: 6,
  Jul: 7, Ago: 8, Sep: 9, Oct: 10, Nov: 11, Dic: 12,
};

const LONG_MAP: Record<string, number> = {
  Enero: 1, Febrero: 2, Marzo: 3, Abril: 4, Mayo: 5, Junio: 6,
  Julio: 7, Agosto: 8, Septiembre: 9, Octubre: 10, Noviembre: 11, Diciembre: 12,
};

/** Parses "Ene 2026" → { year: 2026, month: 1 }. */
export function parseShortSpanishMonthYear(s: string): { year: number; month: number } {
  const [mon, yr] = s.trim().split(/\s+/);
  const month = SHORT_MAP[mon];
  if (!month) throw new Error(`Unknown short Spanish month: ${mon}`);
  return { year: parseInt(yr, 10), month };
}

/** Parses "Enero de 2026" → { year: 2026, month: 1 }. */
export function parseLongSpanishMonthYear(s: string): { year: number; month: number } {
  const m = s.trim().match(/^(\w+)\s+de\s+(\d{4})$/i);
  if (!m) throw new Error(`Cannot parse long Spanish month-year: ${s}`);
  const month = LONG_MAP[m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase()];
  if (!month) throw new Error(`Unknown long Spanish month: ${m[1]}`);
  return { year: parseInt(m[2], 10), month };
}
