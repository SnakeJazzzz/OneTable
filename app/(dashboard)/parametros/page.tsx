'use client';

import { useSkus, useThresholds } from '@/lib/hooks/use-parametros';
import { SkuTable } from '@/components/parametros/sku-table';
import { ImportZone } from '@/components/parametros/import-zone';
import { ThresholdsForm } from '@/components/parametros/thresholds-form';
import { Button } from '@/components/ui/button';

export default function ParametrosPage() {
  const {
    skus,
    loading: skusLoading,
    error: skusError,
    refetch: refetchSkus,
    createSku,
    updateSku,
    deleteSku,
  } = useSkus();

  const {
    cuts,
    loading: thresholdsLoading,
    error: thresholdsError,
    saveCuts,
  } = useThresholds();

  function handleExport() {
    // Trigger file download via direct navigation — the route returns an xlsx blob.
    window.location.href = '/api/parametros/export';
  }

  return (
    <div className="p-8 space-y-6 max-w-5xl">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-foreground">Parámetros</h1>
          <p className="text-muted-foreground">
            Catálogo canónico, precios base y umbrales de alerta de inventario.
          </p>
        </div>
        <Button
          type="button"
          onClick={handleExport}
          className="self-start bg-muted text-foreground hover:bg-muted/80 focus-visible:ring-muted"
        >
          Exportar catálogo
        </Button>
      </header>

      {/* SKU catalog */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Catálogo de SKUs</h2>
        <SkuTable
          skus={skus}
          loading={skusLoading}
          error={skusError}
          onCreate={createSku}
          onUpdate={updateSku}
          onDelete={deleteSku}
        />
      </section>

      {/* Import */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Importar catálogo</h2>
        <ImportZone onImportComplete={refetchSkus} />
      </section>

      {/* Thresholds */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Umbrales de alerta</h2>
        <ThresholdsForm
          cuts={cuts}
          loading={thresholdsLoading}
          error={thresholdsError}
          saveCuts={saveCuts}
        />
      </section>
    </div>
  );
}
