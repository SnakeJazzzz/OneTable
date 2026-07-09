'use client';

import { useId, useRef, useState, type DragEvent } from 'react';
import { CheckCircle2, FileUp, Loader2, Upload, X } from 'lucide-react';
import type { Chain } from '@prisma/client';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const MAX_BYTES = 10 * 1024 * 1024;

interface SuccessSummary {
  rowsTotal: number;
  rowsInserted: number;
  rowsUpdated: number;
  rowsUnmapped: number;
  newUnmappedProducts: number;
  warnings: string[];
  elapsedMs: number;
}

interface UploadFailure {
  message: string;
  detail?: string;
}

interface SingleSlotProps {
  chain: Chain;
  fileType: 'VENTAS' | 'INVENTARIO' | 'MIXED';
  label: string;
  onUploaded: () => void;
}

/** One upload slot (dropzone + submit + feedback). Used internally by ChainUpload. */
function SingleSlot({ chain, fileType, label, onUploaded }: SingleSlotProps) {
  const inputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [success, setSuccess] = useState<SuccessSummary | null>(null);
  const [failure, setFailure] = useState<UploadFailure | null>(null);

  function validateFile(candidate: File): string | null {
    if (!candidate.name.toLowerCase().endsWith('.xlsx')) {
      return 'Solo se aceptan archivos .xlsx';
    }
    if (candidate.size > MAX_BYTES) {
      return `Tamaño máximo 10 MB (recibido ${(candidate.size / 1024 / 1024).toFixed(1)} MB)`;
    }
    return null;
  }

  function acceptFile(candidate: File) {
    setSuccess(null);
    setFailure(null);
    const err = validateFile(candidate);
    if (err) {
      setFileError(err);
      setFile(null);
      return;
    }
    setFileError(null);
    setFile(candidate);
  }

  function clearFile() {
    setFile(null);
    setFileError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function onZoneClick() {
    if (isUploading) return;
    fileInputRef.current?.click();
  }

  function onZoneKey(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onZoneClick();
    }
  }

  function onDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (isUploading) return;
    setIsDragging(true);
  }

  function onDragLeave() {
    setIsDragging(false);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    if (isUploading) return;
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) acceptFile(dropped);
  }

  async function onSubmit() {
    if (!file || isUploading) return;
    setIsUploading(true);
    setFailure(null);

    const formData = new FormData();
    formData.append('files', file);
    formData.append('chain', chain);
    formData.append('fileType', fileType);

    try {
      const res = await fetch('/api/data/upload', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });
      const body = (await res.json().catch(() => null)) as
        | {
            perFile?: Array<
              | {
                  filename: string;
                  chain: string;
                  fileType: string;
                  rowsTotal: number;
                  rowsInserted: number;
                  rowsUpdated: number;
                  rowsUnmapped: number;
                  newUnmappedProducts: number;
                  warnings: string[];
                  elapsedMs: number;
                }
              | { filename: string; error: string }
            >;
            error?: { code: string; message: string };
          }
        | null;

      if (!res.ok) {
        const top = body?.error?.message ?? `Upload falló (${res.status})`;
        const firstFile = body?.perFile?.[0];
        const detail =
          firstFile && 'error' in firstFile ? firstFile.error : JSON.stringify(body ?? {});
        setFailure({ message: top, detail });
        return;
      }

      const firstFile = body?.perFile?.[0];
      if (!firstFile || 'error' in firstFile) {
        setFailure({
          message: 'Error al procesar el archivo',
          detail: firstFile && 'error' in firstFile ? firstFile.error : 'Respuesta inválida',
        });
        return;
      }

      setSuccess({
        rowsTotal: firstFile.rowsTotal,
        rowsInserted: firstFile.rowsInserted,
        rowsUpdated: firstFile.rowsUpdated,
        rowsUnmapped: firstFile.rowsUnmapped,
        newUnmappedProducts: firstFile.newUnmappedProducts,
        warnings: firstFile.warnings,
        elapsedMs: firstFile.elapsedMs,
      });
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      onUploaded();
    } catch (err) {
      console.error('[chain-upload] submit error:', err);
      setFailure({
        message: 'Error al subir el archivo',
        detail: err instanceof Error ? err.message : 'unknown',
      });
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-muted-foreground">{label}</p>

      {/* Dropzone */}
      <div
        role="button"
        tabIndex={isUploading ? -1 : 0}
        aria-disabled={isUploading}
        aria-label={`Subir archivo ${label}. Arrastre el archivo aquí o haga clic para seleccionar.`}
        onClick={onZoneClick}
        onKeyDown={onZoneKey}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={cn(
          'border-2 border-dashed rounded-lg px-4 py-6 text-center transition-colors cursor-pointer',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
          isDragging
            ? 'border-primary bg-primary/5'
            : 'border-border bg-card/50 hover:bg-accent/30',
          isUploading && 'cursor-not-allowed opacity-50',
        )}
      >
        {file ? (
          <div className="flex items-center justify-center gap-3">
            <FileUp className="h-5 w-5 text-primary" aria-hidden="true" />
            <div className="text-left">
              <p className="text-sm font-medium text-foreground">{file.name}</p>
              <p className="text-xs text-muted-foreground">
                {(file.size / 1024).toFixed(0)} KB
              </p>
            </div>
            {!isUploading && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  clearFile();
                }}
                className="ml-2 text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Quitar archivo"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-1">
            <Upload className="h-6 w-6 text-muted-foreground mx-auto" aria-hidden="true" />
            <p className="text-xs text-muted-foreground">
              Arrastrá o hacé clic · solo .xlsx · máx 10 MB
            </p>
          </div>
        )}
        <input
          ref={fileInputRef}
          id={`${inputId}-file`}
          type="file"
          accept=".xlsx"
          className="hidden"
          onChange={(e) => {
            const picked = e.target.files?.[0];
            if (picked) acceptFile(picked);
          }}
        />
      </div>

      {/* Inline file validation error (pre-submit) */}
      {fileError && (
        <p
          role="alert"
          className="text-sm text-destructive-foreground bg-destructive/10 border border-destructive/40 rounded-md px-3 py-2"
        >
          {fileError}
        </p>
      )}

      {/* Submit + progress */}
      <div className="flex flex-col gap-2">
        <Button
          type="button"
          onClick={onSubmit}
          disabled={!file || isUploading || !!fileError}
          className="self-start"
        >
          {isUploading ? (
            <span className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Procesando…
            </span>
          ) : (
            'Subir archivo'
          )}
        </Button>

        {isUploading && (
          <div aria-live="polite">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full w-1/3 bg-primary animate-pulse rounded-full" />
            </div>
          </div>
        )}
      </div>

      {/* Success summary */}
      {success && !isUploading && (
        <div className="rounded-md border border-primary/40 bg-primary/10 p-3 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden="true" />
            <span>Procesado</span>
            <span className="ml-auto text-xs text-muted-foreground">
              {(success.elapsedMs / 1000).toFixed(1)}s
            </span>
          </div>
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Total</dt>
              <dd className="font-semibold text-foreground tabular-nums">{success.rowsTotal}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Nuevas</dt>
              <dd className="font-semibold text-foreground tabular-nums">{success.rowsInserted}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Actualizadas</dt>
              <dd className="font-semibold text-foreground tabular-nums">{success.rowsUpdated}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Sin mapear</dt>
              <dd className="font-semibold text-foreground tabular-nums">{success.rowsUnmapped}</dd>
            </div>
          </dl>
          {success.newUnmappedProducts > 0 && (
            <p className="text-xs text-muted-foreground">
              {success.newUnmappedProducts} producto(s) nuevo(s) sin mapear — resolver en Catálogo.
            </p>
          )}
          {success.warnings.length > 0 && (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer hover:text-foreground">
                {success.warnings.length} advertencia(s)
              </summary>
              <ul className="mt-2 list-disc pl-5 space-y-0.5">
                {success.warnings.slice(0, 10).map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
                {success.warnings.length > 10 && <li>… {success.warnings.length - 10} más</li>}
              </ul>
            </details>
          )}
        </div>
      )}

      {/* Error banner */}
      {failure && !isUploading && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 space-y-2"
        >
          <p className="text-sm font-medium text-destructive-foreground">{failure.message}</p>
          {failure.detail && failure.detail !== '{}' && (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer hover:text-foreground">Ver detalle técnico</summary>
              <pre className="mt-2 whitespace-pre-wrap break-all rounded bg-card/50 p-2 font-mono">
                {failure.detail}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

export interface ChainUploadProps {
  chain: Chain;
  onUploaded: () => void;
}

/**
 * Per-card upload widget. Amazon renders two slots (Ventas + Inventario);
 * all other chains render one slot (MIXED).
 */
export function ChainUpload({ chain, onUploaded }: ChainUploadProps) {
  if (chain === 'AMAZON') {
    return (
      <div className="space-y-6 divide-y divide-border">
        <SingleSlot chain={chain} fileType="VENTAS" label="Ventas" onUploaded={onUploaded} />
        <div className="pt-6">
          <SingleSlot chain={chain} fileType="INVENTARIO" label="Inventario" onUploaded={onUploaded} />
        </div>
      </div>
    );
  }
  return <SingleSlot chain={chain} fileType="MIXED" label="Archivo de datos" onUploaded={onUploaded} />;
}
