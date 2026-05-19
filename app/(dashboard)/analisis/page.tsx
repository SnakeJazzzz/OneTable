'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle2, XCircle } from 'lucide-react';
import type { UploadStatus } from '@prisma/client';
import { useUploads } from '@/lib/hooks/use-uploads';
import { UploadZone } from '@/components/analisis/upload-zone';
import { Card } from '@/components/ui/card';
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

  return (
    <div className="p-8 space-y-6 max-w-5xl">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold text-foreground">Análisis</h1>
        <p className="text-muted-foreground">
          {uploads.length === 0
            ? 'Subí tu primer archivo para empezar a ver tu dashboard consolidado.'
            : 'Subí los archivos de tus portales para consolidar ventas e inventario.'}
        </p>
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
    </div>
  );
}
