'use client';

import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';
import type { SkuRow, CreateSkuInput, UpdateSkuInput } from '@/lib/hooks/use-parametros';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SkuTableProps {
  skus: SkuRow[];
  loading: boolean;
  error: string | null;
  onCreate: (data: CreateSkuInput) => Promise<{ ok: true; sku: SkuRow } | { ok: false; message: string }>;
  onUpdate: (id: string, data: UpdateSkuInput) => Promise<{ ok: true; sku: SkuRow } | { ok: false; message: string }>;
  onDelete: (id: string) => Promise<{ ok: true } | { ok: false; message: string }>;
}

// Blank edit row state
interface EditState {
  nameStandard: string;
  skuCode: string;
  purchasePriceBase: string;
  salePriceBase: string;
}

function emptyEdit(sku?: SkuRow): EditState {
  return {
    nameStandard: sku?.nameStandard ?? '',
    skuCode: sku?.skuCode ?? '',
    purchasePriceBase: sku?.purchasePriceBase ?? '',
    salePriceBase: sku?.salePriceBase ?? '',
  };
}

// ---------------------------------------------------------------------------
// Add-row inline form
// ---------------------------------------------------------------------------

interface AddFormProps {
  onSave: (data: CreateSkuInput) => Promise<{ ok: true } | { ok: false; message: string }>;
  onCancel: () => void;
}

function AddForm({ onSave, onCancel }: AddFormProps) {
  const id = useId();
  const [form, setForm] = useState<EditState>(emptyEdit());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(field: keyof EditState, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
    setError(null);
  }

  async function handleSave() {
    const name = form.nameStandard.trim();
    if (!name) {
      setError('El nombre del producto es obligatorio.');
      return;
    }
    setSaving(true);
    setError(null);
    const payload: CreateSkuInput = { nameStandard: name };
    if (form.skuCode.trim()) payload.skuCode = form.skuCode.trim();
    if (form.purchasePriceBase.trim()) payload.purchasePriceBase = form.purchasePriceBase.trim();
    if (form.salePriceBase.trim()) payload.salePriceBase = form.salePriceBase.trim();
    const result = await onSave(payload);
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
    }
    // Parent handles closing the form on success
  }

  return (
    <tr className="bg-muted/30">
      <td className="p-2">
        <div className="space-y-1">
          <Label htmlFor={`${id}-name`} className="sr-only">Nombre</Label>
          <Input
            id={`${id}-name`}
            value={form.nameStandard}
            onChange={(e) => set('nameStandard', e.target.value)}
            placeholder="Nombre del producto"
            disabled={saving}
            className="h-8 text-sm"
          />
        </div>
      </td>
      <td className="p-2">
        <div className="space-y-1">
          <Label htmlFor={`${id}-code`} className="sr-only">Código</Label>
          <Input
            id={`${id}-code`}
            value={form.skuCode}
            onChange={(e) => set('skuCode', e.target.value)}
            placeholder="Código (opcional)"
            disabled={saving}
            className="h-8 text-sm font-mono"
          />
        </div>
      </td>
      <td className="p-2">
        <Input
          value={form.purchasePriceBase}
          onChange={(e) => set('purchasePriceBase', e.target.value)}
          placeholder="0.00"
          disabled={saving}
          className="h-8 text-sm tabular-nums"
          inputMode="decimal"
        />
      </td>
      <td className="p-2">
        <Input
          value={form.salePriceBase}
          onChange={(e) => set('salePriceBase', e.target.value)}
          placeholder="0.00"
          disabled={saving}
          className="h-8 text-sm tabular-nums"
          inputMode="decimal"
        />
      </td>
      <td className="p-2">
        <div className="flex gap-2">
          <Button type="button" onClick={handleSave} disabled={saving} className="h-8 px-3 text-xs">
            {saving ? 'Guardando…' : 'Guardar'}
          </Button>
          <Button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="h-8 px-3 text-xs bg-muted text-foreground hover:bg-muted/80 focus-visible:ring-muted"
          >
            Cancelar
          </Button>
        </div>
        {error && (
          <p role="alert" className="mt-1 text-xs text-destructive-foreground">
            {error}
          </p>
        )}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Edit-row inline form
// ---------------------------------------------------------------------------

interface EditRowProps {
  sku: SkuRow;
  onSave: (data: UpdateSkuInput) => Promise<{ ok: true } | { ok: false; message: string }>;
  onCancel: () => void;
}

function EditRow({ sku, onSave, onCancel }: EditRowProps) {
  const id = useId();
  const [form, setForm] = useState<EditState>(emptyEdit(sku));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(field: keyof EditState, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
    setError(null);
  }

  async function handleSave() {
    const name = form.nameStandard.trim();
    if (!name) {
      setError('El nombre del producto es obligatorio.');
      return;
    }
    setSaving(true);
    setError(null);
    // Send explicit null/"" for price fields to allow clearing them
    const payload: UpdateSkuInput = {
      nameStandard: name,
      skuCode: form.skuCode.trim(),
      purchasePriceBase: form.purchasePriceBase.trim() || null,
      salePriceBase: form.salePriceBase.trim() || null,
    };
    const result = await onSave(payload);
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
    }
  }

  return (
    <tr className="bg-muted/30">
      <td className="p-2">
        <Input
          id={`${id}-name`}
          value={form.nameStandard}
          onChange={(e) => set('nameStandard', e.target.value)}
          disabled={saving}
          className="h-8 text-sm"
          aria-label="Nombre del producto"
        />
      </td>
      <td className="p-2">
        <div className="space-y-1">
          <Input
            id={`${id}-code`}
            value={form.skuCode}
            onChange={(e) => set('skuCode', e.target.value)}
            disabled={saving}
            className="h-8 text-sm font-mono"
            aria-label="Código SKU"
          />
          <p className="text-xs text-muted-foreground">
            El código se edita desde la app, no desde el Excel. Editarlo aquí crea un SKU nuevo.
          </p>
        </div>
      </td>
      <td className="p-2">
        <Input
          value={form.purchasePriceBase}
          onChange={(e) => set('purchasePriceBase', e.target.value)}
          disabled={saving}
          className="h-8 text-sm tabular-nums"
          inputMode="decimal"
          placeholder="0.00"
          aria-label="Precio de compra"
        />
      </td>
      <td className="p-2">
        <Input
          value={form.salePriceBase}
          onChange={(e) => set('salePriceBase', e.target.value)}
          disabled={saving}
          className="h-8 text-sm tabular-nums"
          inputMode="decimal"
          placeholder="0.00"
          aria-label="Precio de venta"
        />
      </td>
      <td className="p-2">
        <div className="flex gap-2">
          <Button type="button" onClick={handleSave} disabled={saving} className="h-8 px-3 text-xs">
            {saving ? 'Guardando…' : 'Guardar'}
          </Button>
          <Button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="h-8 px-3 text-xs bg-muted text-foreground hover:bg-muted/80 focus-visible:ring-muted"
          >
            Cancelar
          </Button>
        </div>
        {error && (
          <p role="alert" className="mt-1 text-xs text-destructive-foreground">
            {error}
          </p>
        )}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Main SKU table
// ---------------------------------------------------------------------------

export function SkuTable({ skus, loading, error, onCreate, onUpdate, onDelete }: SkuTableProps) {
  const [addingNew, setAddingNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const deleteTarget = skus.find((s) => s.id === deleteTargetId);

  async function handleCreate(data: CreateSkuInput) {
    const result = await onCreate(data);
    if (result.ok) setAddingNew(false);
    return result;
  }

  async function handleUpdate(id: string, data: UpdateSkuInput) {
    const result = await onUpdate(id, data);
    if (result.ok) setEditingId(null);
    return result;
  }

  async function handleDeleteConfirm() {
    if (!deleteTargetId) return;
    setDeleteLoading(true);
    setDeleteError(null);
    const result = await onDelete(deleteTargetId);
    setDeleteLoading(false);
    if (result.ok) {
      setDeleteTargetId(null);
    } else {
      setDeleteError(result.message);
    }
  }

  if (loading) {
    return (
      <Card className="p-4">
        <p className="text-sm text-muted-foreground">Cargando SKUs…</p>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="p-4">
        <p role="alert" className="text-sm text-destructive-foreground">
          {error}
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th className="px-4 py-3 text-left font-medium text-muted-foreground w-2/5">Producto</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground w-1/5">Código</th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground w-1/6">Precio compra</th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground w-1/6">Precio venta</th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground w-1/6">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {skus.length === 0 && !addingNew && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                  No hay SKUs en el catálogo. Agregá el primero o importá un Excel.
                </td>
              </tr>
            )}
            {skus.map((sku) =>
              editingId === sku.id ? (
                <EditRow
                  key={sku.id}
                  sku={sku}
                  onSave={(data) => handleUpdate(sku.id, data)}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <tr
                  key={sku.id}
                  className={cn(
                    'transition-colors',
                    editingId !== null && editingId !== sku.id && 'opacity-50',
                  )}
                >
                  <td className="px-4 py-3 text-foreground font-medium">
                    {sku.nameStandard}
                  </td>
                  <td className="px-4 py-3 font-mono text-muted-foreground">
                    {sku.skuCode || <span className="italic text-xs">sin código</span>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                    {sku.purchasePriceBase != null ? `$${sku.purchasePriceBase}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                    {sku.salePriceBase != null ? `$${sku.salePriceBase}` : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        onClick={() => setEditingId(sku.id)}
                        disabled={addingNew || editingId !== null}
                        className="h-7 px-2 text-xs bg-muted text-foreground hover:bg-muted/80 focus-visible:ring-muted"
                      >
                        Editar
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        onClick={() => {
                          setDeleteError(null);
                          setDeleteTargetId(sku.id);
                        }}
                        disabled={addingNew || editingId !== null}
                        className="h-7 px-2 text-xs"
                      >
                        Eliminar
                      </Button>
                    </div>
                  </td>
                </tr>
              ),
            )}
            {addingNew && (
              <AddForm
                onSave={handleCreate}
                onCancel={() => setAddingNew(false)}
              />
            )}
          </tbody>
        </table>
      </div>

      {!addingNew && editingId === null && (
        <Button
          type="button"
          onClick={() => setAddingNew(true)}
          className="h-8 px-3 text-sm bg-muted text-primary hover:bg-muted/80 focus-visible:ring-muted"
        >
          + Agregar SKU
        </Button>
      )}

      <ConfirmDialog
        open={deleteTargetId !== null}
        title="Eliminar SKU"
        description={
          deleteTarget
            ? `¿Eliminar "${deleteTarget.nameStandard}" del catálogo? Esta acción no se puede deshacer.`
            : '¿Eliminar este SKU del catálogo?'
        }
        confirmLabel="Eliminar"
        loading={deleteLoading}
        errorMessage={deleteError}
        onConfirm={handleDeleteConfirm}
        onCancel={() => {
          if (!deleteLoading) setDeleteTargetId(null);
        }}
      />
    </div>
  );
}
