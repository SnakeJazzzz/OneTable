'use client';

import { useCallback, useState } from 'react';
import type { Chain } from '@prisma/client';
import { Card } from '@/components/ui/card';
import { useChainCounts } from '@/lib/hooks/use-portales';
import { CredentialsForm } from './credentials-form';
import { ChainUpload } from './chain-upload';
import { MappingSection } from './mapping-section';
import { ConflictSection } from './conflict-section';

interface ChainCardProps {
  chain: Chain;
  // FIX #2: lifted from useCredentials() in PortalesGrid — no per-card fetch
  initialUsername: string;
  credLoading: boolean;
}

function displayName(chain: Chain): string {
  return chain.replace(/_/g, ' ');
}

export function ChainCard({ chain, initialUsername, credLoading }: ChainCardProps) {
  // Per-card counts are correctly per-card — still fetched here
  const { counts, loading: countsLoading, refetch: refetchCounts } = useChainCounts(chain);

  // Any mapping/conflict mutation in ANY child (upload, MappingSection,
  // ConflictSection) must refresh BOTH the per-card counts AND the OTHER two
  // sections — they are siblings owning independent queries. A single bumped key,
  // watched by both sections, propagates the refetch (FIX #1: a conflict created
  // in MappingSection must surface in ConflictSection — and a conflict resolved in
  // ConflictSection must return the winner SKU to MappingSection — without reload).
  const [refreshKey, setRefreshKey] = useState(0);
  const handleMutated = useCallback(() => {
    void refetchCounts();
    setRefreshKey((k) => k + 1);
  }, [refetchCounts]);

  const unmappedCount = counts?.unmappedCount ?? 0;
  const pendingReviewCount = counts?.pendingReviewCount ?? 0;
  const conflictCount = counts?.conflictCount ?? 0;

  return (
    <Card className="p-6 space-y-6">
      {/* Header: chain name + per-card counts */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-foreground">{displayName(chain)}</h2>
          {!countsLoading && (
            <p className="mt-1 text-sm text-muted-foreground">
              {unmappedCount} sin mapear · {pendingReviewCount} por verificar · {conflictCount} en conflicto
            </p>
          )}
          {countsLoading && (
            <p className="mt-1 text-xs text-muted-foreground">Cargando conteos…</p>
          )}
        </div>
      </div>

      {/* Configuración incompleta warning (§3.2.4) — FIX #7: a11y attrs */}
      {unmappedCount > 0 && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-md border border-yellow-500/40 bg-yellow-500/10 px-4 py-2 text-sm text-yellow-600 dark:text-yellow-400"
        >
          Configuración incompleta: {unmappedCount} producto(s) sin mapear. Resolver en Portales → Mapeo.
        </div>
      )}

      {/* Credentials */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Credenciales
        </h3>
        {credLoading ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : (
          <CredentialsForm chain={chain} initialUsername={initialUsername} />
        )}
      </section>

      {/* Upload */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Carga de archivos
        </h3>
        <ChainUpload chain={chain} onUploaded={handleMutated} />
      </section>

      {/* Task 10: mapping section — mounted unconditionally so Vista B (multi-value,
          §3.2.1) stays reachable in the stable, fully-mapped state. MappingSection
          owns its "Mapeo" heading and collapses to null when there is nothing to
          map AND nothing mapped. Vista B no longer hides behind the per-card counts.
          onMappingChange now routes through handleMutated so creating a conflict here
          bumps refreshKey → the sibling ConflictSection refetches (FIX #1). */}
      <MappingSection chain={chain} onMappingChange={handleMutated} refreshKey={refreshKey} />

      {/* Task 11: conflict resolution — self-hides when there are no CONFLICTED
          rows. Listens to the shared refreshKey so a conflict fabricated in
          MappingSection appears here without reload; resolving one routes through
          handleMutated so the winner SKU returns to MappingSection (FIX #1). */}
      <ConflictSection chain={chain} onResolved={handleMutated} refreshKey={refreshKey} />
    </Card>
  );
}
