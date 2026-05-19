'use client';

import { cn } from '@/lib/utils';

export interface PeriodSelectorProps {
  periods: string[];
  value: string | undefined;
  onChange: (value: string) => void;
  disabled?: boolean;
}

const MONTH_NAMES_ES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

function formatLabel(period: string): string {
  const [yearStr, monthStr] = period.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (!Number.isInteger(year) || !Number.isInteger(month)) return period;
  const name = MONTH_NAMES_ES[month - 1] ?? monthStr;
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${year}`;
}

export function PeriodSelector({
  periods,
  value,
  onChange,
  disabled,
}: PeriodSelectorProps) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">Período:</span>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled || periods.length === 0}
        className={cn(
          'h-9 rounded-md border border-border bg-card px-3 text-sm text-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
        aria-label="Seleccionar período"
      >
        {(periods.length === 0 || !value) && (
          <option value="" disabled hidden>
            —
          </option>
        )}
        {periods.map((p) => (
          <option key={p} value={p}>
            {formatLabel(p)}
          </option>
        ))}
      </select>
    </label>
  );
}
