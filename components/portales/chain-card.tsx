'use client';

import type { Chain } from '@prisma/client';
import { Card } from '@/components/ui/card';
import { useChainCounts } from '@/lib/hooks/use-portales';
import { CredentialsForm } from './credentials-form';
import { ChainUpload } from './chain-upload';

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
        <ChainUpload chain={chain} onUploaded={refetchCounts} />
      </section>

      {/* TODO Task 10: mapping section */}
      {/* TODO Task 11: conflict section */}
    </Card>
  );
}
