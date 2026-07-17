'use client';

// Forecasting scaffold card (B5 T3, spec §9.2.3).
//
// Renders the honest gate state per chain for one selected product, with the
// REAL counts from GET /api/forecast (never static copy, never an empty
// "coming soon" chart). When the 2.5 baseline-ma3 build merges, the gate
// starts returning forecasts and this card grows the forecast rendering —
// today every series is insufficient by construction.

import { useEffect, useMemo, useState } from 'react';
import type { Chain } from '@prisma/client';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type ForecastOverviewRow = {
  productId: string;
  productName: string;
  chain: Chain;
  monthsAvailable: number;
  nextEligible: string; // YYYY-MM
};

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

// '2026-07' → 'julio 2026' (lowercase, matching the §9.2.3 copy).
function formatMonthEs(yyyymm: string): string {
  const [yearStr, monthStr] = yyyymm.split('-');
  const month = Number(monthStr);
  const name = MONTH_NAMES_ES[month - 1];
  return name ? `${name} ${yearStr}` : yyyymm;
}

// Display convention for chains follows the repo (portales-grid): enum value
// with underscores as spaces, e.g. AL_SUPER → "AL SUPER".
function chainLabel(chain: Chain): string {
  return chain.replace(/_/g, ' ');
}

export function ForecastCard() {
  const [rows, setRows] = useState<ForecastOverviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [productId, setProductId] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/forecast', { credentials: 'include' });
        if (!res.ok) throw new Error(`Forecast request failed (${res.status})`);
        const body = (await res.json()) as { rows: ForecastOverviewRow[] };
        if (!cancelled) setRows(body.rows);
      } catch (err) {
        console.error('[forecast-card] fetch error:', err);
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const products = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) {
      if (!seen.has(r.productId)) seen.set(r.productId, r.productName);
    }
    return Array.from(seen, ([id, name]) => ({ id, name }));
  }, [rows]);

  // Default selection: first product (rows arrive ordered by name).
  useEffect(() => {
    if (productId === undefined && products.length > 0) {
      setProductId(products[0].id);
    }
  }, [products, productId]);

  const selectedRows = rows.filter((r) => r.productId === productId);

  if (loading) {
    return (
      <Card className="p-4">
        <p className="text-sm text-muted-foreground">Cargando…</p>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="p-4">
        <p className="text-sm text-muted-foreground">
          No se pudo cargar el estado de forecasting. Recarga la página para
          intentar de nuevo.
        </p>
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Card className="p-4">
        <p className="text-sm text-muted-foreground">
          Necesito 3 meses de ventas por cadena para predecir. Todavía no hay
          datos de productos del catálogo cargados.
        </p>
      </Card>
    );
  }

  return (
    <Card className="space-y-4 p-4">
      <label className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Producto:</span>
        <select
          value={productId ?? ''}
          onChange={(e) => setProductId(e.target.value)}
          className={cn(
            'h-9 max-w-full rounded-md border border-border bg-card px-3 text-sm text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
          )}
          aria-label="Seleccionar producto para forecasting"
        >
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      <ul className="space-y-2">
        {selectedRows.map((r) => (
          <li
            key={`${r.productId}-${r.chain}`}
            className="rounded-md border border-border p-3 text-sm"
          >
            <p className="font-medium text-foreground">{chainLabel(r.chain)}</p>
            {r.monthsAvailable >= 3 ? (
              // ≥3 months before the 2.5 build lands (documented stub): the
              // gate still answers `insufficient`, so the "necesito 3 meses"
              // copy would contradict the count — announce the build instead.
              <p className="text-muted-foreground">
                Forecast disponible próximamente.
              </p>
            ) : (
              <p className="text-muted-foreground">
                Necesito 3 meses por cadena para predecir. Tienes{' '}
                {r.monthsAvailable} {r.monthsAvailable === 1 ? 'mes' : 'meses'}{' '}
                en {chainLabel(r.chain)}. Próxima predicción:{' '}
                {formatMonthEs(r.nextEligible)}.
              </p>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
