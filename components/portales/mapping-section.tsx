'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Chain } from '@prisma/client';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  useChainMappings,
  useChainSuggestions,
  type MappingRow,
  type SuggestionRow,
} from '@/lib/hooks/use-portales';

// ---- SKU catalog (local fetch, scope kept to this file — no new hook in use-portales) ----

interface Sku {
  id: string;
  skuCode: string;
  nameStandard: string;
}

function useSkuCatalog() {
  const [skus, setSkus] = useState<Sku[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/parametros/skus', { credentials: 'include' });
        if (!res.ok) throw new Error(`SKUs request failed (${res.status})`);
        const body = (await res.json()) as { skus: Sku[] };
        if (!cancelled) setSkus(body.skus);
      } catch (err) {
        console.error('[useSkuCatalog] fetch error:', err);
        if (!cancelled) setError(err instanceof Error ? err.message : 'Error al cargar SKUs');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { skus, loading, error };
}

// ---- Write path ----

type PostOutcome = { kind: 'mapped' } | { kind: 'conflict' } | { kind: 'error'; message: string };

async function postMapping(body: {
  chain: Chain;
  portalString: string;
  productId: string;
  status?: 'CONFIRMED' | 'PENDING_REVIEW';
}): Promise<PostOutcome> {
  try {
    const res = await fetch('/api/portales/mappings', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as
      | { result?: { kind?: string }; error?: { code?: string; message?: string } }
      | null;
    // res.ok FIRST: a 409 carries error.message, never result.kind.
    if (!res.ok) {
      return { kind: 'error', message: data?.error?.message ?? `Error al mapear (${res.status})` };
    }
    // res.ok 200: discriminate result.kind between 'mapped' and 'conflict' (D3).
    if (data?.result?.kind === 'conflict') return { kind: 'conflict' };
    return { kind: 'mapped' };
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : 'Error de red' };
  }
}

type MutateOutcome = { kind: 'ok' } | { kind: 'error'; message: string };

// Shared DELETE/PATCH mutation against /api/portales/mappings (B5-3 B1): both
// verbs answer 200 { ok: true } on success and { error } otherwise. Callers
// keep their own state handling (the setters differ by design); `fallback`
// labels the verb for message-less failures ("Error al quitar (409)").
async function mutateMapping(
  method: 'DELETE' | 'PATCH',
  body: Record<string, unknown>,
  fallback: string,
): Promise<MutateOutcome> {
  try {
    const res = await fetch('/api/portales/mappings', {
      method,
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as
      | { ok?: boolean; error?: { code?: string; message?: string } }
      | null;
    // res.ok FIRST: a 409/404 carries error.message, never { ok }.
    if (!res.ok) {
      return { kind: 'error', message: data?.error?.message ?? `${fallback} (${res.status})` };
    }
    return { kind: 'ok' };
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : 'Error de red' };
  }
}

// ---- Shared bits ----

const selectClasses =
  'flex h-10 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50';

// portalString is set ONLY on the conflict branch (FF-2 part a) — it lets the
// self-clearing effect below target the exact string whose conflict got resolved,
// instead of parsing it back out of `message`.
type Notice = { kind: 'mapped' | 'conflict' | 'error'; message: string; portalString?: string };

interface OutcomeHandler {
  (outcome: PostOutcome, portalString: string): void | Promise<void>;
}

// Delete path: on a successful DELETE the section runs the SAME shared refetch
// (suggestions + mappings) and fires onMappingChange, preserving the Task 11
// cross-propagation (conflict section / dashboard banner). The row string
// disappears and re-enters the "sin mapear" count.
interface DeletedHandler {
  (portalString: string): void | Promise<void>;
}

// Retarget path (§11.6b): on a successful PATCH the section runs the SAME shared
// refetch as delete/map — not a parallel path. The row's string stays mapped, just
// under a different SKU group after the refetch.
interface RetargetedHandler {
  (portalString: string): void | Promise<void>;
}

// Confirm path (FF-1): PENDING_REVIEW -> CONFIRMED via the SAME postMapping POST
// used by Vista A, then the SAME shared refetch as delete/retarget/map. The badge
// disappears because the refetched row comes back CONFIRMED — never optimistic.
interface ConfirmedHandler {
  (portalString: string): void | Promise<void>;
}

function SkuSelect({
  id,
  value,
  onChange,
  skus,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  skus: Sku[];
  disabled?: boolean;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className={selectClasses}
    >
      <option value="">Seleccioná un SKU…</option>
      {skus.map((s) => (
        <option key={s.id} value={s.id}>
          {s.nameStandard} ({s.skuCode})
        </option>
      ))}
    </select>
  );
}

// ---- Vista A: unmapped queue with bands (§5.5) ----

function SuggestionRowItem({
  chain,
  row,
  skus,
  onOutcome,
}: {
  chain: Chain;
  row: SuggestionRow;
  skus: Sku[];
  onOutcome: OutcomeHandler;
}) {
  const { portalString, suggestion } = row;
  const { band } = suggestion;
  const productId = suggestion.productId;
  const idBase = `sug-${chain}-${portalString}`.replace(/[^a-zA-Z0-9-]/g, '_');
  const [submitting, setSubmitting] = useState(false);

  // ONE control for every band (§5.5: a suggestion is pre-filled, never locked).
  // high/medium pre-select the suggested SKU (band high/medium always carries a
  // non-null productId — suggestMatch only returns null in band 'low'); low and
  // codeSkip start empty. The user can always override to another SKU.
  const [picked, setPicked] = useState(band !== 'low' && productId !== null ? productId : '');
  // medium-on-suggestion: required confirmation checkbox.
  const [confirmed, setConfirmed] = useState(false);
  // manual path: optional "marcar por verificar" → PENDING_REVIEW.
  const [markReview, setMarkReview] = useState(false);

  // "On suggestion" = the select still shows the SKU fuzzy proposed. Any override
  // (different SKU, or empty) flips the row into the manual path.
  const onSuggestion = productId !== null && picked === productId;
  // Accepting a (high/medium) proposal vs picking by hand.
  const isAcceptMode = (band === 'high' || band === 'medium') && onSuggestion;
  // medium-on-suggestion is the ONLY case that gates submit behind a confirm.
  const needsConfirm = band === 'medium' && onSuggestion;
  // "Marcar por verificar" lives only on the manual path (low / codeSkip / any
  // override). Accept mode is a deliberate "this match is correct" → CONFIRMED;
  // offering review there would muddy that intent. Status stays opt-in either way.
  const showMarkReview = !isAcceptMode;
  const status: 'CONFIRMED' | 'PENDING_REVIEW' =
    showMarkReview && markReview ? 'PENDING_REVIEW' : 'CONFIRMED';
  const canSubmit = picked !== '' && (!needsConfirm || confirmed) && !submitting;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    const outcome = await postMapping({ chain, portalString, productId: picked, status });
    setSubmitting(false);
    await onOutcome(outcome, portalString);
  }

  return (
    <li className="rounded-md border border-border bg-card/50 p-3 space-y-2">
      <p className="text-sm font-medium text-foreground break-words">{portalString}</p>

      {/* medium-on-suggestion warning + required confirm — shown only while the
          select still holds the proposed SKU. An override hides both (§5.5). */}
      {needsConfirm && (
        <>
          <p
            role="status"
            aria-live="polite"
            className="rounded-md border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-600 dark:text-yellow-400"
          >
            Revisá: coincidencia parcial. Sugerencia:{' '}
            <span className="font-medium">{suggestion.nameStandard}</span>
          </p>
          <div className="flex items-center gap-2">
            <input
              id={`${idBase}-confirm`}
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="h-4 w-4 rounded border-border accent-primary"
            />
            <Label htmlFor={`${idBase}-confirm`}>Confirmo que esta coincidencia es correcta</Label>
          </div>
        </>
      )}

      <div className="space-y-2">
        <div className="space-y-1">
          <Label htmlFor={`${idBase}-select`}>Mapear a SKU</Label>
          <SkuSelect
            id={`${idBase}-select`}
            value={picked}
            onChange={setPicked}
            skus={skus}
            disabled={submitting}
          />
        </div>

        {showMarkReview && (
          <div className="flex items-center gap-2">
            <input
              id={`${idBase}-review`}
              type="checkbox"
              checked={markReview}
              onChange={(e) => setMarkReview(e.target.checked)}
              className="h-4 w-4 rounded border-border accent-primary"
            />
            <Label htmlFor={`${idBase}-review`} className="text-muted-foreground">
              Marcar por verificar
            </Label>
          </div>
        )}

        <Button type="button" onClick={submit} disabled={!canSubmit} className="self-start">
          {submitting ? 'Mapeando…' : isAcceptMode ? 'Aceptar' : 'Mapear'}
        </Button>
      </div>
    </li>
  );
}

// ---- Vista B: already-mapped SKUs, multi-value (§3.2.1) ----

interface MappedGroup {
  productId: string;
  nameStandard: string;
  skuCode: string;
  rows: MappingRow[];
}

function MappedGroupItem({
  chain,
  group,
  skus,
  onOutcome,
  onDeleted,
  onRetargeted,
  onConfirmed,
}: {
  chain: Chain;
  group: MappedGroup;
  skus: Sku[];
  onOutcome: OutcomeHandler;
  onDeleted: DeletedHandler;
  onRetargeted: RetargetedHandler;
  onConfirmed: ConfirmedHandler;
}) {
  const idBase = `map-${chain}-${group.productId}`.replace(/[^a-zA-Z0-9-]/g, '_');
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Delete flow: one dialog at a time, keyed by the portalString being removed.
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Retarget flow (§11.6b): inline per-row edit, one row at a time, keyed by the
  // portalString being edited. No ConfirmDialog — retarget is reversible (retarget
  // back), unlike delete which reverts attributed data to "sin mapear".
  const [editing, setEditing] = useState<string | null>(null);
  const [editPick, setEditPick] = useState('');
  const [retargeting, setRetargeting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Confirm flow (FF-1): PENDING_REVIEW -> CONFIRMED. No dialog (non-destructive,
  // reversible via "Cambiar"/"Quitar"), so `confirming` doubles as the row key AND
  // the in-flight flag — exactly one row confirms at a time within this group.
  const [confirming, setConfirming] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<{ portalString: string; message: string } | null>(
    null,
  );

  async function add() {
    const portalString = value.trim();
    if (!portalString || submitting) return;
    setSubmitting(true);
    const outcome = await postMapping({ chain, portalString, productId: group.productId, status: 'CONFIRMED' });
    setSubmitting(false);
    if (outcome.kind === 'mapped') {
      setValue('');
      setAdding(false);
    }
    await onOutcome(outcome, portalString);
  }

  async function confirmDelete() {
    const portalString = pendingDelete;
    if (portalString === null || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    const outcome = await mutateMapping(
      'DELETE',
      { chain, portalString, productId: group.productId },
      'Error al quitar',
    );
    // Error: the dialog stays open so the user sees why (NO_UPLOAD /
    // CONFLICTED / MAPPING_NOT_FOUND).
    if (outcome.kind === 'error') {
      setDeleteError(outcome.message);
      setDeleting(false);
      return;
    }
    // 200 { ok: true }: close, then run the shared refetch (same path as +Agregar).
    setDeleting(false);
    setPendingDelete(null);
    // Stale twins (B5-3 B2): the deleted row may also own the open edit panel
    // or a confirm error — clear both so neither re-attaches to a future row
    // with the same portalString.
    if (editing === portalString) {
      setEditing(null);
      setEditPick('');
      setEditError(null);
    }
    if (confirmError?.portalString === portalString) setConfirmError(null);
    await onDeleted(portalString);
  }

  // PATCH the edited row only: oldProductId is THE row's SKU (multi-value siblings
  // of the same string under other SKUs are untouched — the service scopes by tuple).
  async function confirmRetarget(portalString: string, oldProductId: string) {
    if (!editPick || retargeting) return;
    setRetargeting(true);
    setEditError(null);
    const outcome = await mutateMapping(
      'PATCH',
      { chain, portalString, oldProductId, newProductId: editPick },
      'Error al cambiar',
    );
    // Error: the row stays in edit mode so the user sees why (CONFLICTED /
    // MAPPING_NOT_FOUND / ...).
    if (outcome.kind === 'error') {
      setEditError(outcome.message);
      setRetargeting(false);
      return;
    }
    // 200 { ok: true }: exit edit mode, then run the shared refetch (same path
    // as Quitar/+Agregar — Task 11 cross-propagation).
    setRetargeting(false);
    setEditing(null);
    setEditPick('');
    await onRetargeted(portalString);
  }

  // Same tuple as the row being confirmed — productId comes from the row itself
  // (never the group's, though they're equal here), so a stray retarget mid-flight
  // can't smuggle a different SKU into the request. Reuses postMapping (the same
  // POST Vista A uses) with status: 'CONFIRMED' explicit, per the backend contract.
  async function confirmRow(portalString: string, productId: string) {
    if (confirming) return;
    setConfirming(portalString);
    setConfirmError(null);
    const outcome = await postMapping({ chain, portalString, productId, status: 'CONFIRMED' });
    if (outcome.kind === 'mapped') {
      // Hold the in-flight flag through the shared refetch (B5-3 B2 / FF-1):
      // unlike delete/retarget (whose UI surface closes on success), this
      // button stays mounted — releasing before the refetch resolves would
      // re-enable it against stale PENDING_REVIEW data.
      await onConfirmed(portalString);
      setConfirming(null);
      return;
    }
    // Error: release immediately so the user can retry.
    setConfirming(null);
    // conflict_exists is not expected in the normal single-user flow (a concurrent
    // write could still produce it) — the fallback message below handles it defensively.
    setConfirmError({
      portalString,
      message: outcome.kind === 'error' ? outcome.message : 'No se pudo confirmar (conflicto inesperado).',
    });
  }

  return (
    <li className="rounded-md border border-border bg-card/50 p-3 space-y-2">
      <p className="text-sm font-medium text-foreground">
        {group.nameStandard}{' '}
        <span className="text-xs font-normal text-muted-foreground">({group.skuCode})</span>
      </p>
      <ul className="space-y-1">
        {group.rows.map((r) => {
          const removing = deleting && pendingDelete === r.portalString;
          const isEditing = editing === r.portalString;
          const editId = `${idBase}-retarget-${r.id}`;
          return (
            <li key={r.id} className="space-y-2 text-sm text-muted-foreground">
              <div className="flex items-center gap-2 break-words">
                <span className="text-foreground">{r.portalString}</span>
                {r.status === 'PENDING_REVIEW' && (
                  <span className="rounded bg-yellow-500/15 px-1.5 py-0.5 text-xs text-yellow-600 dark:text-yellow-400">
                    por verificar
                  </span>
                )}
                {/* "Confirmar" (FF-1): only for PENDING_REVIEW rows — CONFIRMED rows
                    have no outstanding action here. Fires the same POST as Vista A's
                    "Aceptar"/"Mapear", just re-targeted at this row's own tuple. */}
                {r.status === 'PENDING_REVIEW' && (
                  <button
                    type="button"
                    onClick={() => confirmRow(r.portalString, r.productId)}
                    disabled={deleting || retargeting || confirming !== null}
                    aria-label={`Confirmar mapeo de ${r.portalString}`}
                    className="ml-auto text-xs text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {confirming === r.portalString ? 'Confirmando…' : 'Confirmar'}
                  </button>
                )}
                {/* "Cambiar" (§11.6b): inline retarget — no ConfirmDialog, retarget
                    is reversible. Opening it resets any previous pick/error. */}
                <button
                  type="button"
                  onClick={() => {
                    setEditError(null);
                    setEditPick('');
                    if (confirmError?.portalString === r.portalString) setConfirmError(null);
                    setEditing(r.portalString);
                  }}
                  disabled={deleting || retargeting || confirming !== null}
                  aria-label={`Cambiar SKU de ${r.portalString}`}
                  className={cn(
                    'text-xs text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-50',
                    r.status !== 'PENDING_REVIEW' && 'ml-auto',
                  )}
                >
                  Cambiar
                </button>
                {/* Vista B only: discreet destructive-secondary "Quitar" — reverts
                    attributed data, so it always goes through ConfirmDialog. */}
                <button
                  type="button"
                  onClick={() => {
                    setDeleteError(null);
                    if (confirmError?.portalString === r.portalString) setConfirmError(null);
                    setPendingDelete(r.portalString);
                  }}
                  disabled={deleting || retargeting || confirming !== null}
                  aria-label={`Quitar mapeo de ${r.portalString}`}
                  className="text-xs text-destructive hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {removing ? 'Quitando…' : 'Quitar'}
                </button>
              </div>

              {confirmError && confirmError.portalString === r.portalString && (
                <p role="alert" className="text-xs text-destructive">
                  {confirmError.message}
                </p>
              )}

              {isEditing && (
                <div className="space-y-2 rounded-md border border-border bg-card/50 p-2">
                  <div className="space-y-1">
                    <Label htmlFor={editId}>Cambiar a SKU</Label>
                    {/* The CURRENT SKU is excluded: the service's no-op 409 must be
                        unreachable from the UI. */}
                    <SkuSelect
                      id={editId}
                      value={editPick}
                      onChange={setEditPick}
                      skus={skus.filter((s) => s.id !== r.productId)}
                      disabled={retargeting}
                    />
                  </div>
                  {editError && (
                    <p role="alert" className="text-xs text-destructive">
                      {editError}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      onClick={() => confirmRetarget(r.portalString, r.productId)}
                      disabled={retargeting || !editPick}
                    >
                      {retargeting ? 'Cambiando…' : 'Cambiar SKU'}
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={() => {
                        if (!retargeting) {
                          setEditing(null);
                          setEditPick('');
                          setEditError(null);
                        }
                      }}
                      disabled={retargeting}
                    >
                      Cancelar
                    </Button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="¿Quitar este mapeo?"
        description={
          pendingDelete !== null
            ? `El string «${pendingDelete}» se va a desmapear de ${group.nameStandard}. Sus filas vuelven a 'sin mapear' y salen del análisis por SKU hasta que lo remapees.`
            : ''
        }
        confirmLabel="Quitar"
        cancelLabel="Cancelar"
        loading={deleting}
        loadingLabel="Quitando…"
        errorMessage={deleteError}
        onConfirm={confirmDelete}
        onCancel={() => {
          if (!deleting) {
            setPendingDelete(null);
            setDeleteError(null);
          }
        }}
      />

      {adding ? (
        <div className="space-y-2">
          <div className="space-y-1">
            <Label htmlFor={`${idBase}-add`}>Nuevo string del portal</Label>
            <Input
              id={`${idBase}-add`}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Texto exacto del portal"
              disabled={submitting}
            />
          </div>
          <div className="flex gap-2">
            <Button type="button" onClick={add} disabled={submitting || !value.trim()}>
              {submitting ? 'Agregando…' : 'Agregar'}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setAdding(false);
                setValue('');
              }}
              disabled={submitting}
            >
              Cancelar
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="text-sm text-primary hover:underline"
        >
          + Agregar otro string
        </button>
      )}
    </li>
  );
}

// ---- Main ----

export function MappingSection({
  chain,
  onMappingChange,
  refreshKey = 0,
}: {
  chain: Chain;
  onMappingChange: () => void;
  // Bumped by chain-card after a successful upload so this sibling section
  // re-pulls its suggestions/mappings (the upload mutates the unmapped queue).
  refreshKey?: number;
}) {
  const suggestionsQ = useChainSuggestions(chain);
  const mappingsQ = useChainMappings(chain);
  const catalog = useSkuCatalog();
  const [notice, setNotice] = useState<Notice | null>(null);

  // Refetch on upload signal. The hooks already fetch on their own mount, so skip
  // the first run here to avoid a redundant double-fetch on initial render.
  const firstRefresh = useRef(true);
  useEffect(() => {
    if (firstRefresh.current) {
      firstRefresh.current = false;
      return;
    }
    void suggestionsQ.refetch();
    void mappingsQ.refetch();
    // refetch is stable (useCallback per hook); keyed on refreshKey only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  // FF-2 (a): a conflict notice must clear itself once ITS OWN portalString no
  // longer has any CONFLICTED row — i.e. once it got resolved in ConflictSection
  // (either branch: "Es éste" -> CONFIRMED, "Ninguno" -> rows deleted). Reacting to
  // mappingsQ.data (rather than to refreshKey directly) means this only fires once
  // fresh data has actually landed, and only clears THIS notice — a refetch caused
  // by an unrelated mutation (upload, another row) won't have any CONFLICTED row
  // for this string either way, so it's still safe, but the check stays scoped to
  // this string on purpose (never an unconditional clear-on-refetch).
  useEffect(() => {
    if (!notice || notice.kind !== 'conflict' || !notice.portalString) return;
    // A failed refetch leaves mappingsQ.data stale (pre-mutation or pre-resolution)
    // — that's not evidence the conflict got resolved, so skip clearing until a
    // refetch actually succeeds.
    if (mappingsQ.error) return;
    const rows = mappingsQ.data?.mappings;
    if (!rows) return; // data not loaded yet — do not clear on absence (edge case)
    const stillConflicted = rows.some(
      (r) => r.portalString === notice.portalString && r.status === 'CONFLICTED',
    );
    if (!stillConflicted) setNotice(null);
  }, [mappingsQ.data, mappingsQ.error, notice]);

  const handleOutcome = useCallback<OutcomeHandler>(
    async (outcome, portalString) => {
      if (outcome.kind === 'mapped') {
        setNotice({ kind: 'mapped', message: `"${portalString}" mapeado.` });
        await Promise.all([suggestionsQ.refetch(), mappingsQ.refetch()]);
        onMappingChange();
      } else if (outcome.kind === 'conflict') {
        // ORDER IS MANDATORY here (FF-2 fix pass): refetch BEFORE setNotice. The
        // clear-effect below reads mappingsQ.data on every render this notice is
        // conflict-kind. If setNotice ran first, the render it triggers would still
        // see PRE-mutation data (no CONFLICTED row for this string yet — the POST
        // hasn't been reflected by a refetch) and the effect would immediately clear
        // the notice we just set. Refetching first guarantees that by the time the
        // notice exists, mappingsQ.data already contains the CONFLICTED rows, so the
        // effect only clears it once a LATER resolution actually removes them.
        await Promise.all([suggestionsQ.refetch(), mappingsQ.refetch()]);
        setNotice({
          kind: 'conflict',
          portalString,
          message: `"${portalString}" generó un conflicto. Resolvelo en la sección "En conflicto".`,
        });
        onMappingChange();
      } else {
        setNotice({ kind: 'error', message: outcome.message });
      }
    },
    [suggestionsQ, mappingsQ, onMappingChange],
  );

  // Delete reuses the SAME shared refetch + onMappingChange as handleOutcome's
  // mapped branch — NOT a parallel path. Keeps mapping↔conflict↔counts↔banner
  // in sync (Task 11 cross-propagation).
  const handleDeleted = useCallback<DeletedHandler>(
    async (portalString) => {
      setNotice({ kind: 'mapped', message: `"${portalString}" volvió a "sin mapear".` });
      await Promise.all([suggestionsQ.refetch(), mappingsQ.refetch()]);
      onMappingChange();
    },
    [suggestionsQ, mappingsQ, onMappingChange],
  );

  // Retarget reuses the SAME shared refetch + onMappingChange as delete/map —
  // NOT a parallel path (§11.6b). The string re-appears under its new SKU group.
  const handleRetargeted = useCallback<RetargetedHandler>(
    async (portalString) => {
      setNotice({ kind: 'mapped', message: `"${portalString}" cambiado de SKU.` });
      await Promise.all([suggestionsQ.refetch(), mappingsQ.refetch()]);
      onMappingChange();
    },
    [suggestionsQ, mappingsQ, onMappingChange],
  );

  // Confirm (FF-1) reuses the SAME shared refetch + onMappingChange as
  // delete/retarget/map — NOT a parallel path. The "por verificar" badge
  // disappears because the refetched row comes back CONFIRMED.
  const handleConfirmed = useCallback<ConfirmedHandler>(
    async (portalString) => {
      setNotice({ kind: 'mapped', message: `"${portalString}" confirmado.` });
      await Promise.all([suggestionsQ.refetch(), mappingsQ.refetch()]);
      onMappingChange();
    },
    [suggestionsQ, mappingsQ, onMappingChange],
  );

  // Group existing mappings by productId; CONFLICTED rows are NOT rendered as
  // normal mappings (their resolution is Task 11).
  const groups: MappedGroup[] = useMemo(() => {
    const rows = mappingsQ.data?.mappings ?? [];
    const byProduct = new Map<string, MappedGroup>();
    for (const r of rows) {
      if (r.status === 'CONFLICTED') continue;
      let g = byProduct.get(r.productId);
      if (!g) {
        g = { productId: r.productId, nameStandard: r.product.nameStandard, skuCode: r.product.skuCode, rows: [] };
        byProduct.set(r.productId, g);
      }
      g.rows.push(r);
    }
    return [...byProduct.values()];
  }, [mappingsQ.data]);

  const suggestionsData = suggestionsQ.data;
  const codeSkip = suggestionsData?.codeSkip ?? false;
  const queue = suggestionsData?.suggestions ?? [];

  const loading = suggestionsQ.loading || mappingsQ.loading;
  const loadError = suggestionsQ.error ?? mappingsQ.error ?? catalog.error;

  // Vista A depends on queue/codeSkip; Vista B depends on `groups` — NOT on the
  // per-card unmapped/pendingReview counts. chain-card now mounts MappingSection
  // unconditionally, so a fully-clean chain (nothing uploaded, nothing mapped)
  // must collapse to render nothing rather than leave an orphan "Mapeo" heading.
  const hasContent = codeSkip || queue.length > 0 || groups.length > 0;
  if (!loading && !loadError && !hasContent && !notice) {
    return null;
  }

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Mapeo
      </h3>
      <div className="space-y-4">
      {/* Section-level outcome notice (conflict/error survive the queue refetch). */}
      {notice && (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            'rounded-md border px-3 py-2 text-sm',
            notice.kind === 'mapped' && 'border-primary/40 bg-primary/10 text-foreground',
            notice.kind === 'conflict' &&
              'border-yellow-500/40 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
            notice.kind === 'error' && 'border-destructive/40 bg-destructive/10 text-destructive',
          )}
        >
          {notice.message}
        </div>
      )}

      {loadError && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {loadError}
        </p>
      )}

      {loading && !loadError && <p className="text-sm text-muted-foreground">Cargando mapeo…</p>}

      {!loading && !loadError && (
        <>
          {/* Vista A — queue */}
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-foreground">Por mapear</h4>

            {/* §5.4 code column (Amazon ASIN / La Comer EAN): the rows are never
                auto-suggested, but they DO arrive in `queue` (band 'low', null
                suggestion) so each one is mapped by hand through the dropdown
                below. The note is informative, not a dead-end. */}
            {codeSkip && (
              <p className="rounded-md border border-border bg-card/50 px-3 py-2 text-sm text-muted-foreground">
                Columna por código (ASIN/EAN): mapeá cada string manualmente.
              </p>
            )}

            {queue.length === 0 ? (
              <p className="text-sm text-muted-foreground">No hay productos por mapear.</p>
            ) : (
              <ul className="space-y-2">
                {queue.map((row) => (
                  <SuggestionRowItem
                    key={row.portalString}
                    chain={chain}
                    row={row}
                    skus={catalog.skus}
                    onOutcome={handleOutcome}
                  />
                ))}
              </ul>
            )}
          </div>

          {/* Vista B — already mapped */}
          {groups.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-foreground">Ya mapeados</h4>
              <ul className="space-y-2">
                {groups.map((g) => (
                  <MappedGroupItem
                    key={g.productId}
                    chain={chain}
                    group={g}
                    skus={catalog.skus}
                    onOutcome={handleOutcome}
                    onDeleted={handleDeleted}
                    onRetargeted={handleRetargeted}
                    onConfirmed={handleConfirmed}
                  />
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      </div>
    </section>
  );
}
