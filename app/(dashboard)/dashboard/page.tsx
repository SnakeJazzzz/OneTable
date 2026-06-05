'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, DollarSign, Package, TrendingUp } from 'lucide-react';
import { useDashboardData } from '@/lib/hooks/use-dashboard-data';
import { useDashboardPeriods } from '@/lib/hooks/use-dashboard-periods';
import { KpiCard } from '@/components/dashboard/kpi-card';
import { PeriodSelector } from '@/components/dashboard/period-selector';
import { DashboardSkeleton } from '@/components/dashboard/dashboard-skeleton';
import { DashboardEmpty } from '@/components/dashboard/dashboard-empty';
import {
  ByChainChart,
  DaysInvDotPlot,
  SemaforoHeatmap,
  TopSkusSmallMultiples,
  TrendChart,
} from '@/components/dashboard/dashboard-charts';
import { cn } from '@/lib/utils';

const MXN_FORMAT = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  maximumFractionDigits: 0,
});

const UNIT_FORMAT = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 });

function formatVariation(pct: number | null): {
  value: string;
  delta: { value: string; direction: 'up' | 'down' | 'neutral' };
} {
  if (pct === null) {
    return {
      value: '—',
      delta: { value: 'Sin mes previo', direction: 'neutral' },
    };
  }
  const sign = pct >= 0 ? '+' : '';
  const direction = pct > 0 ? 'up' : pct < 0 ? 'down' : 'neutral';
  return {
    value: `${sign}${pct.toFixed(1)}%`,
    delta: { value: 'vs mes anterior', direction },
  };
}

export default function DashboardPage() {
  const { periods, defaultPeriod, loading: periodsLoading } = useDashboardPeriods();
  const [period, setPeriod] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!periodsLoading && defaultPeriod && period === undefined) {
      setPeriod(defaultPeriod);
    }
  }, [periodsLoading, defaultPeriod, period]);

  const { data, loading, refetching, error, isEmpty } = useDashboardData(period);

  if (periodsLoading || loading) {
    return <DashboardSkeleton />;
  }

  if (error) {
    return (
      <div className="p-8">
        <p
          role="alert"
          className="text-sm text-destructive-foreground bg-destructive/10 border border-destructive/40 rounded-md px-4 py-3"
        >
          Error al cargar el dashboard: {error}
        </p>
      </div>
    );
  }

  if (isEmpty || !data) {
    return <DashboardEmpty />;
  }

  const variation = formatVariation(data.kpis.variationPct);

  return (
    <div
      className={cn(
        'p-8 space-y-6 transition-opacity duration-200',
        refetching && 'opacity-60',
      )}
    >
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-3xl font-bold text-foreground">Dashboard</h1>
        {periods.length > 0 && (
          <PeriodSelector
            periods={periods}
            value={period}
            onChange={setPeriod}
            disabled={refetching}
          />
        )}
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Ventas (MXN)"
          value={MXN_FORMAT.format(data.kpis.salesAmountMxn)}
          helper="Excluye cadenas sin reporte en pesos (Amazon, Chedraui)."
          icon={DollarSign}
        />
        <KpiCard
          label="Variación vs mes anterior"
          value={variation.value}
          delta={variation.delta}
          icon={TrendingUp}
        />
        <KpiCard
          label="Unidades vendidas"
          value={UNIT_FORMAT.format(data.kpis.salesUnits)}
          icon={Package}
        />
        <KpiCard
          label="SKUs con alerta activa"
          value={UNIT_FORMAT.format(data.kpis.activeAlertsSkuCount)}
          helper="Estados SIN_STOCK / CRÍTICO / RIESGO"
          icon={AlertTriangle}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TrendChart data={data.trend} />
        <ByChainChart data={data.byChain} />
      </div>

      <SemaforoHeatmap data={data.semaforo} />

      <TopSkusSmallMultiples data={data.topSkus} />

      <DaysInvDotPlot data={data.daysInv} />
    </div>
  );
}
