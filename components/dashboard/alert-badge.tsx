import type { AlertStatus } from '@/core/alerts/classify';
import { cn } from '@/lib/utils';

const STYLE: Record<AlertStatus, string> = {
  SIN_STOCK: 'bg-destructive/15 text-destructive-foreground border-destructive/40',
  CRITICO: 'bg-orange-500/15 text-orange-300 border-orange-500/40',
  RIESGO: 'bg-yellow-400/15 text-yellow-300 border-yellow-400/40',
  ATENCION: 'bg-lime-400/15 text-lime-300 border-lime-400/40',
  OK: 'bg-primary/15 text-primary border-primary/40',
  EXCESO: 'bg-blue-400/15 text-blue-300 border-blue-400/40',
  SIN_DATOS: 'bg-muted text-muted-foreground border-border',
};

const LABEL: Record<AlertStatus, string> = {
  SIN_STOCK: 'Sin stock',
  CRITICO: 'Crítico',
  RIESGO: 'Riesgo',
  ATENCION: 'Atención',
  OK: 'OK',
  EXCESO: 'Exceso',
  SIN_DATOS: 'Sin datos',
};

export function AlertBadge({ alert }: { alert: AlertStatus }) {
  return (
    <span
      className={cn(
        'inline-block rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        STYLE[alert],
      )}
    >
      {LABEL[alert]}
    </span>
  );
}
