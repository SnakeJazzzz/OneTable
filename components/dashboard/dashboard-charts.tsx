'use client';

import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { AlertStatus } from '@/core/alerts/classify';
import type {
  ByChainPoint,
  DaysInvPoint,
  SemaforoPoint,
  TopSkuPoint,
  TrendPoint,
} from '@/lib/hooks/use-dashboard-data';

// Color palette pulled from globals.css token values. Recharts can't read CSS
// vars at render time, so we mirror the HSL values verbatim. Keep in sync with
// app/globals.css.
const COLORS = {
  primary: 'hsl(142 71% 45%)', // --primary
  primaryMuted: 'hsl(142 50% 35%)',
  destructive: 'hsl(0 63% 45%)',
  warningOrange: 'hsl(28 90% 55%)',
  attentionYellow: 'hsl(50 90% 55%)',
  okEmerald: 'hsl(142 71% 45%)',
  excesoBlue: 'hsl(200 70% 50%)',
  noDataGray: 'hsl(240 5% 40%)',
  axis: 'hsl(240 5% 65%)', // --muted-foreground
  grid: 'hsl(240 4% 16%)', // --border
  card: 'hsl(240 10% 6%)', // --card
};

const ALERT_COLOR: Record<AlertStatus, string> = {
  SIN_STOCK: COLORS.destructive,
  CRITICO: COLORS.warningOrange,
  RIESGO: COLORS.attentionYellow,
  // ATENCION is visually adjacent to RIESGO on the scale (14–21 days vs 7–14)
  // but must be distinguishable on the heatmap — shift hue toward yellow-green.
  ATENCION: 'hsl(70 80% 50%)',
  OK: COLORS.okEmerald,
  EXCESO: COLORS.excesoBlue,
  SIN_DATOS: COLORS.noDataGray,
};

const MONTH_SHORT_ES = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
];

function periodLabel(year: number, month: number): string {
  return `${MONTH_SHORT_ES[month - 1]} ${year % 100}`;
}

const formatMxnCompact = (v: number): string => {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
};

const formatUnitsCompact = (v: number): string => {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return String(Math.round(v));
};

const tooltipBaseStyle = {
  backgroundColor: COLORS.card,
  border: `1px solid ${COLORS.grid}`,
  borderRadius: '0.375rem',
  color: 'hsl(0 0% 98%)',
  fontSize: '12px',
};

function ChartCard({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-5 space-y-3">
      <div className="space-y-0.5">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </Card>
  );
}

// =====================================================================
// Chart 1 — Tendencia 6 meses: Ventas + Inventario (ComposedChart)
// Spec §9.1 chart #1 + brief #3 merged. Aggregated across chains.
// =====================================================================

interface TrendChartProps {
  data: TrendPoint[];
}

export function TrendChart({ data }: TrendChartProps) {
  // Aggregate across chains: one row per (year, month) summing sales+inventory.
  const byMonth = useMemo(() => {
    const map = new Map<
      string,
      { key: string; periodYear: number; periodMonth: number; sales: number; inventory: number; hasInv: boolean }
    >();
    for (const r of data) {
      const k = `${r.periodYear}-${String(r.periodMonth).padStart(2, '0')}`;
      const existing = map.get(k);
      if (existing) {
        existing.sales += r.salesAmountMxn;
        if (r.inventoryUnits !== null) {
          existing.inventory += r.inventoryUnits;
          existing.hasInv = true;
        }
      } else {
        map.set(k, {
          key: k,
          periodYear: r.periodYear,
          periodMonth: r.periodMonth,
          sales: r.salesAmountMxn,
          inventory: r.inventoryUnits ?? 0,
          hasInv: r.inventoryUnits !== null,
        });
      }
    }
    return Array.from(map.values())
      .sort((a, b) =>
        a.periodYear === b.periodYear ? a.periodMonth - b.periodMonth : a.periodYear - b.periodYear,
      )
      .map((r) => ({
        label: periodLabel(r.periodYear, r.periodMonth),
        ventas: r.sales,
        inventario: r.hasInv ? r.inventory : null,
      }));
  }, [data]);

  if (byMonth.length === 0) {
    return (
      <ChartCard title="Tendencia 6 meses (ventas + inventario)">
        <p className="text-sm text-muted-foreground">Sin datos disponibles.</p>
      </ChartCard>
    );
  }

  // Spec criterion line 883: single-month case must not look broken.
  const isSinglePoint = byMonth.length === 1;
  const hint = isSinglePoint
    ? 'Solo 1 mes con datos — la tendencia se mostrará al recibir el segundo mes.'
    : 'Ventas totales (barra) e inventario agregado (línea), mes a mes.';

  return (
    <ChartCard title="Tendencia 6 meses (ventas + inventario)" hint={hint}>
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={byMonth} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />
          <XAxis dataKey="label" stroke={COLORS.axis} tick={{ fontSize: 12 }} />
          <YAxis
            yAxisId="ventas"
            stroke={COLORS.primary}
            tick={{ fontSize: 12 }}
            tickFormatter={formatMxnCompact}
            width={70}
          />
          <YAxis
            yAxisId="inventario"
            orientation="right"
            stroke={COLORS.excesoBlue}
            tick={{ fontSize: 12 }}
            tickFormatter={formatUnitsCompact}
            width={60}
          />
          <Tooltip
            contentStyle={tooltipBaseStyle}
            formatter={(value: number, name: string) =>
              name === 'ventas'
                ? [formatMxnCompact(value), 'Ventas MXN']
                : [formatUnitsCompact(value), 'Inventario U']
            }
          />
          <Bar yAxisId="ventas" dataKey="ventas" fill={COLORS.primary} name="ventas" />
          <Line
            yAxisId="inventario"
            type="monotone"
            dataKey="inventario"
            stroke={COLORS.excesoBlue}
            strokeWidth={2}
            name="inventario"
            dot={{ r: 3 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

// =====================================================================
// Chart 2 — Ventas por cadena (mes activo)
// =====================================================================

export function ByChainChart({ data }: { data: ByChainPoint[] }) {
  const sorted = useMemo(
    () => [...data].sort((a, b) => b.salesAmountMxn - a.salesAmountMxn),
    [data],
  );

  if (sorted.length === 0) {
    return (
      <ChartCard title="Ventas por cadena">
        <p className="text-sm text-muted-foreground">Sin ventas en el período.</p>
      </ChartCard>
    );
  }

  return (
    <ChartCard
      title="Ventas por cadena"
      hint="Ventas MXN del período activo. Amazon y Chedraui no reportan pesos."
    >
      <ResponsiveContainer width="100%" height={280}>
        <BarChart
          layout="vertical"
          data={sorted}
          margin={{ top: 8, right: 16, bottom: 8, left: 24 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />
          <XAxis
            type="number"
            stroke={COLORS.axis}
            tick={{ fontSize: 12 }}
            tickFormatter={formatMxnCompact}
          />
          <YAxis
            type="category"
            dataKey="chain"
            stroke={COLORS.axis}
            tick={{ fontSize: 12 }}
            width={90}
          />
          <Tooltip
            contentStyle={tooltipBaseStyle}
            formatter={(value: number) => [formatMxnCompact(value), 'Ventas MXN']}
          />
          <Bar dataKey="salesAmountMxn" fill={COLORS.primary} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

// =====================================================================
// Chart 3 — Semáforo inventario por SKU (CSS-grid heatmap)
// Recharts has no native heatmap, so we render a colored CSS grid keyed by
// (productName, chain) → alert.
// =====================================================================

export function SemaforoHeatmap({ data }: { data: SemaforoPoint[] }) {
  const { products, chains, cellAlert } = useMemo(() => {
    const productSet = new Set<string>();
    const chainSet = new Set<string>();
    const map = new Map<string, AlertStatus>();
    for (const r of data) {
      productSet.add(r.productName);
      chainSet.add(r.chain);
      map.set(`${r.productName}|${r.chain}`, r.alert);
    }
    return {
      products: Array.from(productSet).sort(),
      chains: Array.from(chainSet).sort(),
      cellAlert: map,
    };
  }, [data]);

  if (products.length === 0) {
    return (
      <ChartCard title="Semáforo inventario por SKU">
        <p className="text-sm text-muted-foreground">Sin SKUs en el período.</p>
      </ChartCard>
    );
  }

  return (
    <ChartCard
      title="Semáforo inventario por SKU"
      hint="Estado de alerta agregado (worst-case por SKU × cadena)."
    >
      <div className="overflow-x-auto">
        <div
          className="grid gap-1 min-w-[400px]"
          style={{
            gridTemplateColumns: `minmax(140px, 1fr) repeat(${chains.length}, minmax(56px, 1fr))`,
          }}
          role="table"
          aria-label="Semáforo por SKU y cadena"
        >
          <div className="text-xs font-semibold text-muted-foreground" role="columnheader">
            SKU
          </div>
          {chains.map((c) => (
            <div
              key={c}
              className="text-xs font-semibold text-muted-foreground text-center"
              role="columnheader"
            >
              {c}
            </div>
          ))}

          {products.map((p) => (
            <div key={p} role="row" className="contents">
              <div
                className="text-xs text-foreground truncate py-1.5"
                title={p}
                role="rowheader"
              >
                {p}
              </div>
              {chains.map((c) => {
                const alert = cellAlert.get(`${p}|${c}`);
                return (
                  <div
                    key={c}
                    className="h-7 rounded-sm"
                    style={{ backgroundColor: alert ? ALERT_COLOR[alert] : 'transparent' }}
                    title={alert ? `${p} × ${c}: ${alert}` : `${p} × ${c}: sin datos`}
                    role="cell"
                    aria-label={`${p} ${c} ${alert ?? 'sin datos'}`}
                  />
                );
              })}
            </div>
          ))}
        </div>
        <ul className="mt-4 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {(
            ['SIN_STOCK', 'CRITICO', 'RIESGO', 'ATENCION', 'OK', 'EXCESO', 'SIN_DATOS'] as AlertStatus[]
          ).map((a) => (
            <li key={a} className="flex items-center gap-1.5">
              <span
                className="inline-block h-3 w-3 rounded-sm"
                style={{ backgroundColor: ALERT_COLOR[a] }}
              />
              <span>{a}</span>
            </li>
          ))}
        </ul>
      </div>
    </ChartCard>
  );
}

// =====================================================================
// Chart 4 — Top 5 SKUs por cadena (small multiples)
// =====================================================================

export function TopSkusSmallMultiples({ data }: { data: TopSkuPoint[] }) {
  const grouped = useMemo(() => {
    const map = new Map<string, TopSkuPoint[]>();
    for (const r of data) {
      const list = map.get(r.chain) ?? [];
      list.push(r);
      map.set(r.chain, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [data]);

  if (grouped.length === 0) {
    return (
      <ChartCard title="Top 5 SKUs por cadena">
        <p className="text-sm text-muted-foreground">Sin SKUs en el período.</p>
      </ChartCard>
    );
  }

  return (
    <ChartCard
      title="Top 5 SKUs por cadena"
      hint="Unidades vendidas del período activo, por cadena reportante."
    >
      <div
        className={cn(
          'grid gap-4',
          grouped.length === 1 ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
        )}
      >
        {grouped.map(([chain, items]) => (
          <div key={chain} className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground">{chain}</h3>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart
                layout="vertical"
                data={items}
                margin={{ top: 4, right: 8, bottom: 4, left: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />
                <XAxis
                  type="number"
                  stroke={COLORS.axis}
                  tick={{ fontSize: 11 }}
                  tickFormatter={formatUnitsCompact}
                />
                <YAxis
                  type="category"
                  dataKey="productName"
                  stroke={COLORS.axis}
                  tick={{ fontSize: 10 }}
                  width={110}
                  interval={0}
                />
                <Tooltip
                  contentStyle={tooltipBaseStyle}
                  formatter={(value: number) => [formatUnitsCompact(value), 'Unidades']}
                />
                <Bar dataKey="salesUnits" fill={COLORS.primary} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ))}
      </div>
    </ChartCard>
  );
}

// =====================================================================
// Chart 5 — Días de inventario por SKU (dot plot con thresholds)
// =====================================================================

export function DaysInvDotPlot({ data }: { data: DaysInvPoint[] }) {
  // Build per-row dataset: y = product index, x = daysOfInventory.
  // Filter null values (no signal possible) — those rows can't be plotted.
  const { points, productLabels } = useMemo(() => {
    const productSet = Array.from(new Set(data.map((r) => r.productName))).sort();
    const labels = productSet.map((p, i) => ({ value: i, label: p }));
    const indexOf = new Map(productSet.map((p, i) => [p, i]));
    const pts = data
      .filter((r) => r.daysOfInventory !== null)
      .map((r) => ({
        x: r.daysOfInventory as number,
        y: indexOf.get(r.productName) ?? 0,
        productName: r.productName,
        chain: r.chain,
      }));
    return { points: pts, productLabels: labels };
  }, [data]);

  if (productLabels.length === 0) {
    return (
      <ChartCard title="Días de inventario por SKU">
        <p className="text-sm text-muted-foreground">Sin SKUs con cobertura calculable.</p>
      </ChartCard>
    );
  }

  // Cap X axis at 90 to keep thresholds (7/14/21/60) readable; outliers tag along.
  const maxX = Math.max(90, ...points.map((p) => p.x));

  return (
    <ChartCard
      title="Días de inventario por SKU"
      hint="Worst-case por SKU × cadena. Líneas verticales en thresholds del semáforo (7, 14, 21, 60)."
    >
      <ResponsiveContainer width="100%" height={Math.max(240, productLabels.length * 22)}>
        <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />
          <XAxis
            type="number"
            dataKey="x"
            stroke={COLORS.axis}
            tick={{ fontSize: 11 }}
            domain={[0, maxX]}
            label={{ value: 'días', position: 'insideBottom', offset: -2, fontSize: 11, fill: COLORS.axis }}
          />
          <YAxis
            type="number"
            dataKey="y"
            stroke={COLORS.axis}
            tick={{ fontSize: 10 }}
            width={140}
            ticks={productLabels.map((l) => l.value)}
            tickFormatter={(v: number) => productLabels[v]?.label ?? ''}
            interval={0}
          />
          <ReferenceLine
            x={7}
            stroke={COLORS.warningOrange}
            strokeDasharray="2 2"
            label={{ value: '7d', position: 'top', fontSize: 10, fill: COLORS.axis }}
          />
          <ReferenceLine
            x={14}
            stroke={COLORS.attentionYellow}
            strokeDasharray="2 2"
            label={{ value: '14d', position: 'top', fontSize: 10, fill: COLORS.axis }}
          />
          <ReferenceLine
            x={21}
            stroke={'hsl(70 80% 50%)'}
            strokeDasharray="2 2"
            label={{ value: '21d', position: 'top', fontSize: 10, fill: COLORS.axis }}
          />
          <ReferenceLine
            x={60}
            stroke={COLORS.excesoBlue}
            strokeDasharray="2 2"
            label={{ value: '60d', position: 'top', fontSize: 10, fill: COLORS.axis }}
          />
          <Tooltip
            cursor={{ stroke: COLORS.grid }}
            content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) return null;
              const p = payload[0].payload as {
                x: number;
                productName: string;
                chain: string;
              };
              return (
                <div
                  style={tooltipBaseStyle}
                  className="rounded-md px-2 py-1"
                >
                  <div className="font-medium">{p.productName}</div>
                  <div className="text-xs text-muted-foreground">
                    {p.chain} · {p.x.toFixed(1)} días
                  </div>
                </div>
              );
            }}
          />
          <Scatter data={points} fill={COLORS.primary} />
        </ScatterChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
