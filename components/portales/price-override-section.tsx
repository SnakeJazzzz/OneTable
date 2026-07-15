'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Chain } from '@prisma/client';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useChainPriceOverrides, type PriceOverrideRow } from '@/lib/hooks/use-portales';

// Per-chain price overrides (§3.2.4): the card mirrors the global catalog
// prices; each row can override sale/purchase for THIS chain. Empty input =
// no override for that field; both empty = no row at all (PUT with nulls →
// the route deletes the row; absence = use base, §4.3).
//
// NOTE (B-1 scope): the purchase override is stored but not consumed by any
// query yet — only salePrice feeds SALES_AMOUNT_CASCADE in core/kpis/queries.ts.

function money(v: string | null): string {
  return v != null ? `$${v}` : '—';
}

interface OverrideRowItemProps {
  chain: Chain;
  row: PriceOverrideRow;
  onSaved: () => Promise<void>;
}

function OverrideRowItem({ chain, row, onSaved }: OverrideRowItemProps) {
  const serverPurchase = row.override?.purchasePrice ?? '';
  const serverSale = row.override?.salePrice ?? '';
  const [purchase, setPurchase] = useState(serverPurchase);
  const [sale, setSale] = useState(serverSale);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-sync inputs when the refetched server state changes (credentials-form
  // FIX #3 precedent). saved/error are NOT blind-cleared here: `saved` is set
  // only after the refetch resolves, so the re-sync must not wipe it — user
  // edits clear both instead.
  useEffect(() => {
    setPurchase(serverPurchase);
    setSale(serverSale);
  }, [serverPurchase, serverSale]);

  const dirty = purchase.trim() !== serverPurchase || sale.trim() !== serverSale;

  function edit(setter: (v: string) => void) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      setter(e.target.value);
      setSaved(false);
      setError(null);
    };
  }

  async function save() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      // Declarative PUT: all four keys always explicit; empty input → null.
      const res = await fetch('/api/portales/price-overrides', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chain,
          productId: row.productId,
          purchasePrice: purchase.trim() || null,
          salePrice: sale.trim() || null,
        }),
      });
      if (!res.ok) {
        // res.ok BEFORE parsing the body (inherited footgun): an error page
        // without a JSON body must not explode the handler.
        let message = `Error al guardar (${res.status})`;
        try {
          const body = (await res.json()) as { error?: { message?: string } };
          if (body.error?.message) message = body.error.message;
        } catch {
          // keep the status-based message
        }
        throw new Error(message);
      }
      // Success is conditional on refetched data, not a blind clear: the ✓
      // only appears after the parent refetch resolved and the inputs
      // re-synced to the persisted truth.
      await onSaved();
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="rounded-md border border-border p-3 space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-foreground">{row.nameStandard}</p>
        <p className="font-mono text-xs text-muted-foreground">{row.skuCode}</p>
      </div>
      {/* Global prices, read-only reference — the placeholders below repeat
          them so an empty input visually signals "falls back to global". */}
      <p className="text-xs text-muted-foreground tabular-nums">
        Global: compra {money(row.purchasePriceBase)} · venta {money(row.salePriceBase)}
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor={`po-purchase-${chain}-${row.productId}`} className="text-xs">
            Compra (esta cadena)
          </Label>
          <Input
            id={`po-purchase-${chain}-${row.productId}`}
            value={purchase}
            onChange={edit(setPurchase)}
            inputMode="decimal"
            placeholder={row.purchasePriceBase ?? '—'}
            disabled={saving}
            className="h-8 w-32 text-sm tabular-nums"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`po-sale-${chain}-${row.productId}`} className="text-xs">
            Venta (esta cadena)
          </Label>
          <Input
            id={`po-sale-${chain}-${row.productId}`}
            value={sale}
            onChange={edit(setSale)}
            inputMode="decimal"
            placeholder={row.salePriceBase ?? '—'}
            disabled={saving}
            className="h-8 w-32 text-sm tabular-nums"
          />
        </div>
        <Button type="button" onClick={save} disabled={saving || !dirty} className="h-8 px-3 text-xs">
          {saving ? 'Guardando…' : 'Guardar'}
        </Button>
      </div>
      {saved && <p className="text-xs text-primary">Guardado ✓</p>}
      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {error}
        </p>
      )}
    </li>
  );
}

export function PriceOverrideSection({ chain }: { chain: Chain }) {
  const { data, loading, error, refetch } = useChainPriceOverrides(chain);
  // Collapsed by default — the cards are already long with mapping + conflicts.
  const [expanded, setExpanded] = useState(false);

  const rows = data?.rows ?? [];
  const overrideCount = rows.filter((r) => r.override !== null).length;

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Precios especiales
      </h3>

      {loading && <p className="text-sm text-muted-foreground">Cargando precios…</p>}

      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      {/* Empty catalog → small empty state with a CTA to Parámetros. The
          section stays visible so the user learns WHERE overrides live. */}
      {!loading && !error && rows.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No hay SKUs en el catálogo. Agregalos en{' '}
          <Link href="/parametros" className="text-primary underline underline-offset-2">
            Parámetros
          </Link>{' '}
          para poder configurar precios especiales por cadena.
        </p>
      )}

      {!loading && !error && rows.length > 0 && (
        <>
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              {overrideCount} de {rows.length} producto(s) con precio especial
            </p>
            <Button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              aria-expanded={expanded}
              className="h-8 px-3 text-xs bg-muted text-foreground hover:bg-muted/80 focus-visible:ring-muted"
            >
              {expanded ? 'Ocultar' : 'Editar precios'}
            </Button>
          </div>
          {expanded && (
            <ul className="space-y-3">
              {rows.map((row) => (
                <OverrideRowItem key={row.productId} chain={chain} row={row} onSaved={refetch} />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
