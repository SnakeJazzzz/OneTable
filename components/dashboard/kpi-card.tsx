import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';

export interface KpiCardProps {
  label: string;
  value: string;
  /** Optional secondary line — e.g., variation % or tooltip text. */
  delta?: {
    value: string;
    direction: 'up' | 'down' | 'neutral';
  } | null;
  /** Optional disclaimer rendered as small muted copy below the value. */
  helper?: string;
  icon?: LucideIcon;
}

const directionClasses: Record<'up' | 'down' | 'neutral', string> = {
  up: 'text-primary',
  down: 'text-destructive-foreground',
  neutral: 'text-muted-foreground',
};

export function KpiCard({ label, value, delta, helper, icon: Icon }: KpiCardProps) {
  return (
    <Card className="p-5 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
        {Icon && <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
      </div>
      <div className="text-3xl font-bold text-foreground tabular-nums">{value}</div>
      {delta && (
        <div className={cn('text-xs font-medium', directionClasses[delta.direction])}>
          {delta.value}
        </div>
      )}
      {helper && <div className="text-xs text-muted-foreground">{helper}</div>}
    </Card>
  );
}
