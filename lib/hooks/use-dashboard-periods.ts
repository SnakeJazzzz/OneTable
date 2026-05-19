'use client';

import { useEffect, useState } from 'react';

export interface UsePeriodsResult {
  periods: string[];
  defaultPeriod: string | null;
  loading: boolean;
  error: string | null;
}

export function useDashboardPeriods(): UsePeriodsResult {
  const [periods, setPeriods] = useState<string[]>([]);
  const [defaultPeriod, setDefaultPeriod] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/dashboard/periods', { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Periods request failed (${res.status})`);
        return (await res.json()) as { periods: string[]; defaultPeriod: string | null };
      })
      .then((body) => {
        if (cancelled) return;
        setPeriods(body.periods);
        setDefaultPeriod(body.defaultPeriod);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('[useDashboardPeriods] fetch error:', err);
        setError(err instanceof Error ? err.message : 'Error al cargar períodos');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { periods, defaultPeriod, loading, error };
}
