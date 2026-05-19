'use client';

import { useState } from 'react';

export interface UseResetDataResult {
  reset: () => Promise<boolean>;
  loading: boolean;
  error: string | null;
  /** Clear the last error message (used when the dialog is reopened). */
  clearError: () => void;
}

export function useResetData(): UseResetDataResult {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reset(): Promise<boolean> {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/data/reset', {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { code?: string; message?: string };
        };
        throw new Error(body.error?.message ?? `Error ${res.status}`);
      }
      return true;
    } catch (err) {
      console.error('[useResetData] error:', err);
      setError(err instanceof Error ? err.message : 'Error al borrar datos');
      return false;
    } finally {
      setLoading(false);
    }
  }

  return { reset, loading, error, clearError: () => setError(null) };
}
