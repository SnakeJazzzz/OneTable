'use client';

import { useId, useRef, useState, type DragEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const MAX_BYTES = 10 * 1024 * 1024;

interface ImportResult {
  created: number;
  updated: number;
  skippedNoName: number;
  newCatalogMode: boolean;
  warnings: string[];
}

export interface ImportZoneProps {
  onImportComplete: () => void;
}

export function ImportZone({ onImportComplete }: ImportZoneProps) {
  const inputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

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
    setResult(null);
    setImportError(null);
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
    setImportError(null);
    setResult(null);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/parametros/import', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      const body = (await res.json().catch(() => null)) as
        | ImportResult
        | { error?: { code?: string; message?: string } }
        | null;

      if (!res.ok) {
        const errBody = body as { error?: { message?: string } } | null;
        const msg = errBody?.error?.message ?? `Error al importar (${res.status})`;
        setImportError(msg);
        return;
      }

      const okBody = body as ImportResult;
      setResult(okBody);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      onImportComplete();
    } catch (err) {
      console.error('[import-zone] submit error:', err);
      setImportError(err instanceof Error ? err.message : 'Error al importar');
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <Card className="p-5 space-y-4">
      {/* §10.2 microcopy */}
      <p className="text-sm text-muted-foreground">
        Para actualizar SKUs existentes, exportá primero el catálogo desde Parámetros. La columna
        Código es el enlace entre tu Excel y tus SKUs.
      </p>

      {/* Dropzone */}
      <div
        role="button"
        tabIndex={isUploading ? -1 : 0}
        aria-disabled={isUploading}
        aria-label="Importar catálogo Excel. Arrastre el archivo aquí o haga clic para seleccionar."
        onClick={onZoneClick}
        onKeyDown={onZoneKey}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={cn(
          'border-2 border-dashed rounded-lg px-6 py-8 text-center transition-colors cursor-pointer',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
          isDragging
            ? 'border-primary bg-primary/5'
            : 'border-border bg-card/50 hover:bg-accent/30',
          isUploading && 'cursor-not-allowed opacity-50',
        )}
      >
        {file ? (
          <div className="flex items-center justify-center gap-3">
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
                className="ml-2 text-sm text-muted-foreground hover:text-foreground transition-colors underline"
                aria-label="Quitar archivo"
              >
                Quitar
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">
              Arrastrá el archivo aquí o hacé clic para seleccionar
            </p>
            <p className="text-xs text-muted-foreground">
              Solo .xlsx · máx 10 MB
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

      {fileError && (
        <p
          role="alert"
          className="text-sm text-destructive-foreground bg-destructive/10 border border-destructive/40 rounded-md px-3 py-2"
        >
          {fileError}
        </p>
      )}

      <Button
        type="button"
        onClick={onSubmit}
        disabled={!file || isUploading || !!fileError}
        className="self-start"
      >
        {isUploading ? 'Importando…' : 'Importar Excel'}
      </Button>

      {/* Import result */}
      {result && !isUploading && (
        <div className="rounded-md border border-primary/40 bg-primary/10 p-4 space-y-2">
          <p className="text-sm font-medium text-foreground">Importación completada</p>
          <dl className="grid grid-cols-3 gap-2 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Creados</dt>
              <dd className="font-semibold text-foreground tabular-nums">{result.created}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Actualizados</dt>
              <dd className="font-semibold text-foreground tabular-nums">{result.updated}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Omitidos (sin nombre)</dt>
              <dd className="font-semibold text-foreground tabular-nums">{result.skippedNoName}</dd>
            </div>
          </dl>
          {result.warnings.length > 0 && (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer hover:text-foreground">
                {result.warnings.length} advertencia(s)
              </summary>
              <ul className="mt-2 list-disc pl-5 space-y-0.5">
                {result.warnings.slice(0, 20).map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
                {result.warnings.length > 20 && (
                  <li>… {result.warnings.length - 20} más</li>
                )}
              </ul>
            </details>
          )}
        </div>
      )}

      {importError && !isUploading && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-4"
        >
          <p className="text-sm font-medium text-destructive-foreground">{importError}</p>
        </div>
      )}
    </Card>
  );
}
