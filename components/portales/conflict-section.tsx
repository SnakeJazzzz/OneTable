'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Chain } from '@prisma/client';
import { Button } from '@/components/ui/button';
import { useChainConflicts } from '@/lib/hooks/use-portales';

// §8.4 microcopy — shown verbatim above the conflict list.
const CONFLICT_HELP =
  'Las filas en conflicto suman en los totales generales pero no en el análisis por SKU. Resolvé el conflicto para que entren al detalle del producto.';

type PostResult = { ok: true } | { ok: false; message: string };

async function postResolution(body: {
  chain: Chain;
  portalString: string;
  winnerProductId: string | null;
}): Promise<PostResult> {
  try {
    const res = await fetch('/api/portales/conflicts', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      // firstSeenUploadId is SERVER-DERIVED for "Ninguno" — never sent from the UI.
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as
      | { ok?: boolean; error?: { code?: string; message?: string } }
      | null;
    // res.ok FIRST: a 409 (INVALID_WINNER / NO_UPLOAD) carries a Spanish message.
    if (!res.ok) {
      return {
        ok: false,
        message: data?.error?.message ?? `Error al resolver el conflicto (${res.status})`,
      };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Error de red' };
  }
}

function ConflictItem({
  chain,
  conflict,
  onResolved,
}: {
  chain: Chain;
  conflict: { portalString: string; candidates: { productId: string; nameStandard: string; skuCode: string }[] };
  onResolved: () => void | Promise<void>;
}) {
  const { portalString, candidates } = conflict;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resolve(winnerProductId: string | null) {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    const result = await postResolution({ chain, portalString, winnerProductId });
    setSubmitting(false);
    if (result.ok) {
      // Parent refetches conflicts + counts; this item unmounts on success.
      await onResolved();
    } else {
      setError(result.message);
    }
  }

  return (
    <li className="rounded-md border border-orange-500/40 bg-orange-500/10 p-3 space-y-2">
      <p className="text-sm font-medium text-orange-700 dark:text-orange-300 break-words">
        {portalString}
      </p>

      <ul className="space-y-2">
        {candidates.map((c) => (
          <li
            key={c.productId}
            className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
          >
            <span className="text-sm text-foreground break-words">
              {c.nameStandard}{' '}
              <span className="text-xs font-normal text-muted-foreground">({c.skuCode})</span>
            </span>
            <Button
              type="button"
              onClick={() => resolve(c.productId)}
              disabled={submitting}
              className="self-start sm:self-auto"
            >
              Es éste
            </Button>
          </li>
        ))}
      </ul>

      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="destructive"
          onClick={() => resolve(null)}
          disabled={submitting}
        >
          Ninguno
        </Button>
        {submitting && <span className="text-xs text-muted-foreground">Resolviendo…</span>}
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}
    </li>
  );
}

export function ConflictSection({
  chain,
  onResolved,
  refreshKey = 0,
}: {
  chain: Chain;
  // Card passes handleMutated so resolving updates the per-card header counts AND
  // bumps the shared refreshKey the sibling MappingSection listens to (FIX #1).
  onResolved: () => void;
  // Bumped by chain-card on ANY mapping/conflict mutation. When MappingSection
  // fabricates a conflict, this section must re-pull and appear without reload.
  refreshKey?: number;
}) {
  const { data, error, refetch } = useChainConflicts(chain);
  const conflicts = data?.conflicts ?? [];

  // Mirror MappingSection's anti-double-fetch guard: the hook already fetches on
  // its own mount, so skip the first effect run and only refetch on later bumps.
  const firstRefresh = useRef(true);
  useEffect(() => {
    if (firstRefresh.current) {
      firstRefresh.current = false;
      return;
    }
    void refetch();
    // refetch is stable (useCallback in the hook); keyed on refreshKey only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const handleResolved = useCallback(async () => {
    await refetch();
    onResolved();
  }, [refetch, onResolved]);

  // FIX #2: a failed conflicts load must NOT look like "all resolved". Surface the
  // error BEFORE the empty self-hide so a load failure renders inline instead of
  // silently returning null (which is indistinguishable from the good state).
  if (error) {
    return (
      <section className="space-y-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          En conflicto
        </h3>
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          No se pudieron cargar los conflictos.
        </p>
      </section>
    );
  }

  // Self-hide when there is nothing in conflict (the card owns counts).
  if (conflicts.length === 0) return null;

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        En conflicto
      </h3>
      <p className="text-sm text-muted-foreground">{CONFLICT_HELP}</p>
      <ul className="space-y-2">
        {conflicts.map((conflict) => (
          <ConflictItem
            key={conflict.portalString}
            chain={chain}
            conflict={conflict}
            onResolved={handleResolved}
          />
        ))}
      </ul>
    </section>
  );
}
