'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Chain } from '@prisma/client';

// ---- Credentials ----

export interface CredentialRow {
  chain: Chain;
  username: string;
  isActive: boolean;
  hasPasswordPending: boolean;
}

export interface UseCredentialsResult {
  credentials: CredentialRow[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useCredentials(): UseCredentialsResult {
  const [credentials, setCredentials] = useState<CredentialRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/portales/credentials', { credentials: 'include' });
      if (!res.ok) throw new Error(`Credentials request failed (${res.status})`);
      const body = (await res.json()) as { credentials: CredentialRow[] };
      setCredentials(body.credentials);
    } catch (err) {
      console.error('[useCredentials] fetch error:', err);
      setError(err instanceof Error ? err.message : 'Error al cargar credenciales');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { credentials, loading, error, refetch };
}

// ---- Chain Counts ----

export interface ChainCounts {
  unmappedCount: number;
  pendingReviewCount: number;
  conflictCount: number;
}

export interface UseChainCountsResult {
  counts: ChainCounts | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useChainCounts(chain: Chain): UseChainCountsResult {
  const [counts, setCounts] = useState<ChainCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/portales/counts?chain=${chain}`, { credentials: 'include' });
      if (!res.ok) throw new Error(`Counts request failed (${res.status})`);
      const body = (await res.json()) as ChainCounts;
      setCounts(body);
    } catch (err) {
      console.error('[useChainCounts] fetch error:', err);
      setError(err instanceof Error ? err.message : 'Error al cargar conteos');
    } finally {
      setLoading(false);
    }
  }, [chain]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { counts, loading, error, refetch };
}

// ---- Chain Mappings ----
// Consumed in Task 10/11 (mapping/conflict UI).

export interface UseChainMappingsResult {
  // TODO Task 10/11: replace unknown with the real row interface before consuming.
  data: unknown;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useChainMappings(chain: Chain): UseChainMappingsResult {
  // Consumed in Task 10/11 (mapping/conflict UI).
  const [data, setData] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/portales/mappings?chain=${chain}`, { credentials: 'include' });
      if (!res.ok) throw new Error(`Mappings request failed (${res.status})`);
      setData(await res.json());
    } catch (err) {
      console.error('[useChainMappings] fetch error:', err);
      setError(err instanceof Error ? err.message : 'Error al cargar mappings');
    } finally {
      setLoading(false);
    }
  }, [chain]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { data, loading, error, refetch };
}

// ---- Chain Suggestions ----
// Consumed in Task 10/11 (mapping/conflict UI).

export interface UseChainSuggestionsResult {
  // TODO Task 10/11: replace unknown with the real row interface before consuming.
  data: unknown;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useChainSuggestions(chain: Chain): UseChainSuggestionsResult {
  // Consumed in Task 10/11 (mapping/conflict UI).
  const [data, setData] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/portales/mappings/suggestions?chain=${chain}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`Suggestions request failed (${res.status})`);
      setData(await res.json());
    } catch (err) {
      console.error('[useChainSuggestions] fetch error:', err);
      setError(err instanceof Error ? err.message : 'Error al cargar sugerencias');
    } finally {
      setLoading(false);
    }
  }, [chain]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { data, loading, error, refetch };
}

// ---- Chain Conflicts ----
// Consumed in Task 10/11 (mapping/conflict UI).

export interface UseChainConflictsResult {
  // TODO Task 10/11: replace unknown with the real row interface before consuming.
  data: unknown;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useChainConflicts(chain: Chain): UseChainConflictsResult {
  // Consumed in Task 10/11 (mapping/conflict UI).
  const [data, setData] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/portales/conflicts?chain=${chain}`, { credentials: 'include' });
      if (!res.ok) throw new Error(`Conflicts request failed (${res.status})`);
      setData(await res.json());
    } catch (err) {
      console.error('[useChainConflicts] fetch error:', err);
      setError(err instanceof Error ? err.message : 'Error al cargar conflictos');
    } finally {
      setLoading(false);
    }
  }, [chain]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { data, loading, error, refetch };
}
