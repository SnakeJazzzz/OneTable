'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Chain, FileType, UploadStatus } from '@prisma/client';

export interface UploadRow {
  id: string;
  chain: Chain;
  fileType: FileType;
  status: UploadStatus;
  originalFilename: string;
  rowsTotal: number;
  rowsInserted: number;
  rowsUpdated: number;
  rowsUnmapped: number;
  uploadedAt: string;
  processedAt: string | null;
}

export interface UseUploadsResult {
  uploads: UploadRow[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useUploads(): UseUploadsResult {
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/uploads', { credentials: 'include' });
      if (!res.ok) throw new Error(`Uploads request failed (${res.status})`);
      const body = (await res.json()) as { uploads: UploadRow[] };
      setUploads(body.uploads);
    } catch (err) {
      console.error('[useUploads] fetch error:', err);
      setError(err instanceof Error ? err.message : 'Error al cargar uploads');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { uploads, loading, error, refetch };
}
