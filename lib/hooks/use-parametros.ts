'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ThresholdCuts } from '@/core/alerts/classify';

// ---------------------------------------------------------------------------
// SKU types
// ---------------------------------------------------------------------------

export interface SkuRow {
  id: string;
  skuCode: string;
  nameStandard: string;
  purchasePriceBase: string | null;
  salePriceBase: string | null;
}

export interface UseSkusResult {
  skus: SkuRow[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  createSku: (data: CreateSkuInput) => Promise<{ ok: true; sku: SkuRow } | { ok: false; message: string }>;
  updateSku: (id: string, data: UpdateSkuInput) => Promise<{ ok: true; sku: SkuRow } | { ok: false; message: string }>;
  deleteSku: (id: string) => Promise<{ ok: true } | { ok: false; message: string }>;
}

export interface CreateSkuInput {
  nameStandard: string;
  skuCode?: string;
  purchasePriceBase?: string;
  salePriceBase?: string;
}

export interface UpdateSkuInput {
  nameStandard?: string;
  skuCode?: string;
  purchasePriceBase?: string | null;
  salePriceBase?: string | null;
}

// ---------------------------------------------------------------------------
// Thresholds types
// ---------------------------------------------------------------------------

export interface UseThresholdsResult {
  cuts: ThresholdCuts | null;
  loading: boolean;
  error: string | null;
  saveCuts: (data: ThresholdCuts) => Promise<{ ok: true; cuts: ThresholdCuts } | { ok: false; message: string }>;
  refetch: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Error shape from errorResponse() in lib/auth-helpers.ts
// { error: { code: string; message: string } }
// ---------------------------------------------------------------------------

async function extractErrorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    return body?.error?.message ?? `Error del servidor (${res.status})`;
  } catch {
    return `Error del servidor (${res.status})`;
  }
}

// ---------------------------------------------------------------------------
// useSkus
// ---------------------------------------------------------------------------

export function useSkus(): UseSkusResult {
  const [skus, setSkus] = useState<SkuRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/parametros/skus', { credentials: 'include' });
      if (!res.ok) {
        const msg = await extractErrorMessage(res);
        throw new Error(msg);
      }
      const body = (await res.json()) as { skus: SkuRow[] };
      setSkus(body.skus);
    } catch (err) {
      console.error('[useSkus] fetch error:', err);
      setError(err instanceof Error ? err.message : 'Error al cargar SKUs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const createSku = useCallback(
    async (data: CreateSkuInput): Promise<{ ok: true; sku: SkuRow } | { ok: false; message: string }> => {
      try {
        const res = await fetch('/api/parametros/skus', {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(data),
        });
        if (!res.ok) {
          const message = await extractErrorMessage(res);
          return { ok: false, message };
        }
        const body = (await res.json()) as { sku: SkuRow };
        await refetch();
        return { ok: true, sku: body.sku };
      } catch (err) {
        console.error('[useSkus] createSku error:', err);
        return { ok: false, message: err instanceof Error ? err.message : 'Error al crear SKU' };
      }
    },
    [refetch],
  );

  const updateSku = useCallback(
    async (id: string, data: UpdateSkuInput): Promise<{ ok: true; sku: SkuRow } | { ok: false; message: string }> => {
      try {
        const res = await fetch(`/api/parametros/skus/${id}`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(data),
        });
        if (!res.ok) {
          const message = await extractErrorMessage(res);
          return { ok: false, message };
        }
        const body = (await res.json()) as { sku: SkuRow };
        await refetch();
        return { ok: true, sku: body.sku };
      } catch (err) {
        console.error('[useSkus] updateSku error:', err);
        return { ok: false, message: err instanceof Error ? err.message : 'Error al actualizar SKU' };
      }
    },
    [refetch],
  );

  const deleteSku = useCallback(
    async (id: string): Promise<{ ok: true } | { ok: false; message: string }> => {
      try {
        const res = await fetch(`/api/parametros/skus/${id}`, {
          method: 'DELETE',
          credentials: 'include',
        });
        if (!res.ok) {
          const message = await extractErrorMessage(res);
          return { ok: false, message };
        }
        await refetch();
        return { ok: true };
      } catch (err) {
        console.error('[useSkus] deleteSku error:', err);
        return { ok: false, message: err instanceof Error ? err.message : 'Error al eliminar SKU' };
      }
    },
    [refetch],
  );

  return { skus, loading, error, refetch, createSku, updateSku, deleteSku };
}

// ---------------------------------------------------------------------------
// useThresholds
// ---------------------------------------------------------------------------

export function useThresholds(): UseThresholdsResult {
  const [cuts, setCuts] = useState<ThresholdCuts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/parametros/thresholds', { credentials: 'include' });
      if (!res.ok) {
        const msg = await extractErrorMessage(res);
        throw new Error(msg);
      }
      const body = (await res.json()) as { cuts: ThresholdCuts };
      setCuts(body.cuts);
    } catch (err) {
      console.error('[useThresholds] fetch error:', err);
      setError(err instanceof Error ? err.message : 'Error al cargar umbrales');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const saveCuts = useCallback(
    async (data: ThresholdCuts): Promise<{ ok: true; cuts: ThresholdCuts } | { ok: false; message: string }> => {
      try {
        const res = await fetch('/api/parametros/thresholds', {
          method: 'PUT',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(data),
        });
        if (!res.ok) {
          const message = await extractErrorMessage(res);
          return { ok: false, message };
        }
        const body = (await res.json()) as { cuts: ThresholdCuts };
        setCuts(body.cuts);
        return { ok: true, cuts: body.cuts };
      } catch (err) {
        console.error('[useThresholds] saveCuts error:', err);
        return { ok: false, message: err instanceof Error ? err.message : 'Error al guardar umbrales' };
      }
    },
    [],
  );

  return { cuts, loading, error, refetch, saveCuts };
}
