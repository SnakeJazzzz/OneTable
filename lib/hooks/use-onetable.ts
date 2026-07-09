'use client';

import { useEffect, useState } from 'react';
import type { Chain } from '@prisma/client';
import type { AlertStatus } from '@/core/alerts/classify';

export interface OneTableRow {
  id: string;
  chain: Chain;
  storeId: string | null;
  storeName: string | null;
  productId: string | null;
  productName: string;
  portalRawProduct: string;
  periodYear: number;
  periodMonth: number;
  salesUnits: number | null;
  salesUnitsEstimated: boolean;
  salesAmountMxn: number | null;
  inventoryUnits: number | null;
  daysOfInventory: number | null;
  alert: AlertStatus;
  isUnmapped: boolean;
}

export interface UseOneTableResult {
  rows: OneTableRow[];
  loading: boolean;
  error: string | null;
}

function buildPeriodQuery(periodKey: string | undefined): string {
  if (!periodKey) return '';
  const [yearStr, monthStr] = periodKey.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (!Number.isInteger(year) || !Number.isInteger(month)) return '';
  return `?periodYear=${year}&periodMonth=${month}`;
}

export function useOneTable(periodKey?: string): UseOneTableResult {
  const [rows, setRows] = useState<OneTableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    const url = `/api/dashboard/onetable${buildPeriodQuery(periodKey)}`;
    fetch(url, { credentials: 'include', signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`OneTable request failed (${res.status})`);
        return (await res.json()) as { rows: OneTableRow[] };
      })
      .then((body) => {
        if (controller.signal.aborted) return;
        setRows(body.rows);
        setLoading(false);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        console.error('[useOneTable] fetch error:', err);
        setError(err instanceof Error ? err.message : 'Error al cargar la tabla');
        setLoading(false);
      });

    return () => controller.abort();
  }, [periodKey]);

  return { rows, loading, error };
}
