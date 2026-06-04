'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle2, Trash2, XCircle } from 'lucide-react';
import type { UploadStatus } from '@prisma/client';
import { useUploads } from '@/lib/hooks/use-uploads';
import { useResetData } from '@/lib/hooks/use-reset-data';
import { useDashboardPeriods } from '@/lib/hooks/use-dashboard-periods';
import { PeriodSelector } from '@/components/dashboard/period-selector';
import { OneTable } from '@/components/dashboard/onetable';
import { UploadZone } from '@/components/analisis/upload-zone';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';

const DT_FORMAT = new Intl.DateTimeFormat('es-MX', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function formatChainFileType(chain: string, fileType: string): string {
  const t = fileType === 'MIXED' ? 'Mixto' : fileType === 'VENTAS' ? 'Ventas' : 'Inventario';
  return `${chain} — ${t}`;
}

const STATUS_ES: Record<UploadStatus, string> = {
  PENDING: 'Pendiente',
  PROCESSING: 'Procesando',
  COMPLETED: 'Completado',
  FAILED: 'Falló',
};

export default function AnalisisPage() {
  const router = useRouter();
  const { uploads, loading, refetch } = useUploads();
  const [resetOpen, setResetOpen] = useState(false);
  const { reset, loading: resetLoading, error: resetError, clearError } = useResetData();
  const { periods, defaultPeriod, loading: periodsLoading } = useDashboardPeriods();
  const [period, setPeriod] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!periodsLoading && defaultPeriod && period === undefined) {
      setPeriod(defaultPeriod);
    }
  }, [periodsLoading, defaultPeriod, period]);

  async function handleUploadComplete() {
    // Read the closure value BEFORE refetch so we capture "was this the first
    // upload?" against the pre-refresh state. The hook will update `uploads`
    // asynchronously after refetch resolves; checking before is the correct
    // signal. No ref/state needed.
    const wasFirstUpload = uploads.length === 0;
    await refetch();
    if (wasFirstUpload) {
      setTimeout(() => router.push('/dashboard'), 1500);
    }
  }

  function openResetDialog() {
    clearError();
    setResetOpen(true);
  }

  async function handleResetConfirm() {
    const ok = await reset();
    if (ok) {
      setResetOpen(false);
      await refetch();
      router.refresh();
    }
    // If !ok, dialog stays open with errorMessage rendered.
  }

  return (
    <div className="p-8 space-y-6 max-w-5xl">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-foreground">Análisis</h1>
          <p className="text-muted-foreground">
            {uploads.length === 0
              ? 'Subí tu primer archivo para empezar a ver tu dashboard consolidado.'
              : 'Subí los archivos de tus portales para consolidar ventas e inventario.'}
          </p>
        </div>
        {uploads.length > 0 && (
          <Button
            type="button"
            variant="destructive"
            onClick={openResetDialog}
            className="gap-2"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            Borrar data
          </Button>
        )}
      </header>

      <UploadZone onUploadComplete={handleUploadComplete} />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Uploads recientes</h2>
        {loading ? (
          <Card className="p-4">
            <p className="text-sm text-muted-foreground">Cargando…</p>
          </Card>
        ) : uploads.length === 0 ? (
          <Card className="p-4">
            <p className="text-sm text-muted-foreground">Todavía no hay uploads.</p>
          </Card>
        ) : (
          <Card>
            <ul className="divide-y divide-border">
              {uploads.map((u) => {
                const completed = u.status === 'COMPLETED';
                const failed = u.status === 'FAILED';
                return (
                  <li key={u.id} className="flex items-center gap-3 p-4">
                    <span
                      aria-hidden="true"
                      className={cn(
                        'flex h-8 w-8 items-center justify-center rounded-full',
                        completed && 'bg-primary/15 text-primary',
                        failed && 'bg-destructive/15 text-destructive-foreground',
                        !completed && !failed && 'bg-muted text-muted-foreground',
                      )}
                    >
                      {completed && <CheckCircle2 className="h-4 w-4" />}
                      {failed && <XCircle className="h-4 w-4" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground" title={u.originalFilename}>
                        {u.originalFilename}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatChainFileType(u.chain, u.fileType)} · {DT_FORMAT.format(new Date(u.uploadedAt))}
                      </p>
                    </div>
                    {completed && (
                      <div className="hidden sm:block text-right text-xs text-muted-foreground tabular-nums">
                        <p>{u.rowsTotal} filas</p>
                        <p>
                          {u.rowsInserted} nuevas · {u.rowsUpdated} actualizadas
                        </p>
                      </div>
                    )}
                    <span
                      className={cn(
                        'inline-block rounded-full px-2 py-0.5 text-xs font-medium',
                        completed && 'bg-primary/15 text-primary',
                        failed && 'bg-destructive/15 text-destructive-foreground',
                        !completed && !failed && 'bg-muted text-muted-foreground',
                      )}
                    >
                      {STATUS_ES[u.status]}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
        {uploads.length > 0 && (
          <p className="text-sm text-muted-foreground">
            Para ver KPIs y gráficas, ir a{' '}
            <Link href="/dashboard" className="text-primary hover:underline">
              Dashboard
            </Link>
            .
          </p>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-semibold text-foreground">Detalle consolidado</h2>
          {periods.length > 0 && (
            <PeriodSelector
              periods={periods}
              value={period}
              onChange={setPeriod}
              disabled={periodsLoading}
            />
          )}
        </div>
        <OneTable periodKey={period} />
      </section>

      <ConfirmDialog
        open={resetOpen}
        title="Borrar todos los datos"
        description="Esta acción es permanente y no se puede deshacer. Se borrarán todos los archivos cargados y las alertas generadas. Tu cuenta y catálogo se mantienen."
        confirmLabel="Sí, borrar todo"
        loading={resetLoading}
        errorMessage={resetError}
        onConfirm={handleResetConfirm}
        onCancel={() => setResetOpen(false)}
      />
    </div>
  );
}
