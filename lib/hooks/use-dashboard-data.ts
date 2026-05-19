'use client';

import { useEffect, useState } from 'react';
import type { Chain } from '@prisma/client';
import type { AlertStatus } from '@/core/alerts/classify';

export type DashboardKpis = {
  salesAmountMxn: number;
  variationPct: number | null;
  salesUnits: number;
  activeAlertsSkuCount: number;
};

export type TrendPoint = {
  chain: Chain;
  periodYear: number;
  periodMonth: number;
  salesAmountMxn: number;
  salesUnits: number;
  inventoryUnits: number | null;
};

export type ByChainPoint = {
  chain: Chain;
  salesAmountMxn: number;
  salesUnits: number;
};

export type SemaforoPoint = {
  productId: string | null;
  productName: string;
  chain: Chain;
  alert: AlertStatus;
};

export type TopSkuPoint = {
  chain: Chain;
  productName: string;
  salesUnits: number;
};

export type DaysInvPoint = {
  productName: string;
  chain: Chain;
  daysOfInventory: number | null;
};

export interface DashboardData {
  period: { year: number; month: number } | null;
  kpis: DashboardKpis;
  trend: TrendPoint[];
  byChain: ByChainPoint[];
  semaforo: SemaforoPoint[];
  topSkus: TopSkuPoint[];
  daysInv: DaysInvPoint[];
}

interface DashboardApiResponse extends DashboardData {
  noData: boolean;
}

export interface UseDashboardDataResult {
  data: DashboardData | null;
  /** True only on the FIRST load (no data yet, no empty resolved). Drives full skeleton. */
  loading: boolean;
  /** True when a period change is in flight while stale data is visible. Drives dim overlay. */
  refetching: boolean;
  error: string | null;
  isEmpty: boolean;
}

function buildPeriodQuery(periodKey: string | undefined): string {
  if (!periodKey) return '';
  const [yearStr, monthStr] = periodKey.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (!Number.isInteger(year) || !Number.isInteger(month)) return '';
  return `?periodYear=${year}&periodMonth=${month}`;
}

export function useDashboardData(periodKey?: string): UseDashboardDataResult {
  const [data, setData] = useState<DashboardData | null>(null);
  const [isFetching, setIsFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEmpty, setIsEmpty] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setIsFetching(true);
    setError(null);

    const url = `/api/dashboard/kpis${buildPeriodQuery(periodKey)}`;

    fetch(url, { credentials: 'include', signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Dashboard request failed (${res.status})`);
        }
        return (await res.json()) as DashboardApiResponse;
      })
      .then((body) => {
        if (controller.signal.aborted) return;
        if (body.noData) {
          setIsEmpty(true);
          setData(null);
        } else {
          setIsEmpty(false);
          setData({
            period: body.period,
            kpis: body.kpis,
            trend: body.trend,
            byChain: body.byChain,
            semaforo: body.semaforo,
            topSkus: body.topSkus,
            daysInv: body.daysInv,
          });
        }
        setIsFetching(false);
      })
      .catch((err) => {
        // AbortError fires when the effect cleanup cancels an in-flight fetch
        // (period change races). Ignore — the new effect already set fresh state.
        if (err instanceof DOMException && err.name === 'AbortError') return;
        console.error('[useDashboardData] fetch error:', err);
        setError(err instanceof Error ? err.message : 'Error al cargar el dashboard');
        setIsFetching(false);
      });

    return () => {
      controller.abort();
    };
  }, [periodKey]);

  // First load = nothing to show yet (no data and no empty resolved). After
  // that, period changes mark `refetching` so the UI can dim instead of
  // dropping back to the full skeleton.
  const loading = isFetching && data === null && !isEmpty;
  const refetching = isFetching && !loading;

  return { data, loading, refetching, error, isEmpty };
}
