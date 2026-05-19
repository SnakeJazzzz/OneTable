'use client';

import { useId, useRef, useState, type DragEvent } from 'react';
import { CheckCircle2, FileUp, Loader2, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const MAX_BYTES = 10 * 1024 * 1024;

// Selector options. Spec §7.2.5 #1 + #2: 4 enabled + 6 disabled (HEB/AL SUPER/
// LA COMER ×2 each, mirroring Amazon's split into Ventas + Inventario).
type SlotKey = string;

type Slot = {
  key: SlotKey;
  label: string;
  enabled: boolean;
  /** All needles must appear (case-insensitive) in the uploaded filename, per
   * the server's filename-based detector in app/api/data/upload/route.ts.
   * Empty array for disabled slots — they never get a file submitted. */
  filenameNeedles: string[];
  /** Tooltip shown on hover for disabled options. */
  tooltip?: string;
};

const SLOTS: Slot[] = [
  // Enabled (4)
  { key: 'soriana-mixto', label: 'Soriana — Mixto', enabled: true, filenameNeedles: ['soriana'] },
  { key: 'chedraui-mixto', label: 'Chedraui — Mixto', enabled: true, filenameNeedles: ['chedraui'] },
  { key: 'amazon-ventas', label: 'Amazon — Ventas', enabled: true, filenameNeedles: ['amazon', 'ventas'] },
  { key: 'amazon-inv', label: 'Amazon — Inventario', enabled: true, filenameNeedles: ['amazon', 'inv'] },
  // Disabled (6) — HEB / AL SUPER / LA COMER × (Ventas, Inventario)
  { key: 'heb-ventas', label: 'HEB — Ventas', enabled: false, filenameNeedles: [], tooltip: 'Próximamente — llega después del demo' },
  { key: 'heb-inv', label: 'HEB — Inventario', enabled: false, filenameNeedles: [], tooltip: 'Próximamente — llega después del demo' },
  { key: 'al-super-ventas', label: 'AL SUPER — Ventas', enabled: false, filenameNeedles: [], tooltip: 'Próximamente — llega después del demo' },
  { key: 'al-super-inv', label: 'AL SUPER — Inventario', enabled: false, filenameNeedles: [], tooltip: 'Próximamente — llega después del demo' },
  { key: 'la-comer-ventas', label: 'LA COMER — Ventas', enabled: false, filenameNeedles: [], tooltip: 'Próximamente — llega después del demo' },
  { key: 'la-comer-inv', label: 'LA COMER — Inventario', enabled: false, filenameNeedles: [], tooltip: 'Próximamente — llega después del demo' },
];

function slotMatchesFilename(slot: Slot, filename: string): boolean {
  const lower = filename.toLowerCase();
  return slot.filenameNeedles.every((n) => lower.includes(n));
}

interface SuccessSummary {
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

interface UploadFailure {
  message: string;
  detail?: string;
}

export interface UploadZoneProps {
  /** Called after a successful upload so the page can refresh recent-uploads. */
  onUploadComplete: () => void;
}

export function UploadZone({ onUploadComplete }: UploadZoneProps) {
  const inputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [slotKey, setSlotKey] = useState<SlotKey>(SLOTS[0].key);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [success, setSuccess] = useState<SuccessSummary | null>(null);
  const [failure, setFailure] = useState<UploadFailure | null>(null);

  const slot = SLOTS.find((s) => s.key === slotKey) ?? SLOTS[0];

  function validateFile(candidate: File, currentSlot: Slot): string | null {
    if (!candidate.name.toLowerCase().endsWith('.xlsx')) {
      return 'Solo se aceptan archivos .xlsx';
    }
    if (candidate.size > MAX_BYTES) {
      return `Tamaño máximo 10 MB (recibido ${(candidate.size / 1024 / 1024).toFixed(1)} MB)`;
    }
    if (!slotMatchesFilename(currentSlot, candidate.name)) {
      const list = currentSlot.filenameNeedles.map((n) => `"${n}"`).join(' + ');
      return `El nombre del archivo debe contener: ${list}`;
    }
    return null;
  }

  function acceptFile(candidate: File) {
    setSuccess(null);
    setFailure(null);
    const err = validateFile(candidate, slot);
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

  function onSlotChange(key: SlotKey) {
    // G5b: every slot change fully resets file-related state. Previously we
    // only cleared on validation mismatch, which left a stale `fileError`
    // message referencing the OLD slot when the user changed slots without
    // first picking a file — making the input look "frozen" until a second
    // change. Simpler + more predictable: pick slot, then pick file.
    setSlotKey(key);
    setSuccess(null);
    setFailure(null);
    setFileError(null);
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function onZoneClick() {
    if (isUploading) return;
    fileInputRef.current?.click();
  }

  function onZoneKey(e: React.KeyboardEvent<HTMLDivElement>) {
    // Only react to keys originating on the dropzone itself; let the inner
    // "Quitar archivo" X-button handle its own Enter/Space without bubbling
    // back into "open picker".
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
    // Endpoint accepts `file` OR `files` field name. We use `files` to match
    // the multipart shape in app/api/data/upload/route.ts:125.
    formData.append('files', file);

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
        filename: firstFile.filename,
        chain: firstFile.chain,
        fileType: firstFile.fileType,
        rowsTotal: firstFile.rowsTotal,
        rowsInserted: firstFile.rowsInserted,
        rowsUpdated: firstFile.rowsUpdated,
        rowsUnmapped: firstFile.rowsUnmapped,
        newUnmappedProducts: firstFile.newUnmappedProducts,
        warnings: firstFile.warnings,
        elapsedMs: firstFile.elapsedMs,
      });
      // Reset file selection so the next slot can be tried.
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      onUploadComplete();
    } catch (err) {
      console.error('[upload-zone] submit error:', err);
      setFailure({
        message: 'Error al subir el archivo',
        detail: err instanceof Error ? err.message : 'unknown',
      });
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <Card className="p-6 space-y-4">
      {/* Selector */}
      <div className="space-y-2">
        <label htmlFor={`${inputId}-slot`} className="text-sm font-medium text-foreground">
          Cadena y tipo de archivo
        </label>
        <select
          id={`${inputId}-slot`}
          value={slotKey}
          onChange={(e) => onSlotChange(e.target.value)}
          disabled={isUploading}
          className="w-full sm:w-80 h-10 rounded-md border border-border bg-card px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {SLOTS.map((s) => (
            <option
              key={s.key}
              value={s.key}
              disabled={!s.enabled}
              title={s.tooltip ?? undefined}
            >
              {s.label}
              {!s.enabled ? ' (próximamente)' : ''}
            </option>
          ))}
        </select>
      </div>

      {/* Dropzone */}
      <div
        role="button"
        tabIndex={isUploading ? -1 : 0}
        aria-disabled={isUploading}
        aria-label={`Subir archivo para ${slot.label}. Arrastre el archivo aquí o haga clic para seleccionar.`}
        onClick={onZoneClick}
        onKeyDown={onZoneKey}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={cn(
          'border-2 border-dashed rounded-lg px-6 py-10 text-center transition-colors cursor-pointer',
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
                {(file.size / 1024).toFixed(0)} KB · {slot.label}
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
          <div className="space-y-2">
            <Upload className="h-8 w-8 text-muted-foreground mx-auto" aria-hidden="true" />
            <p className="text-sm font-medium text-foreground">
              Arrastrá el archivo aquí o hacé clic para seleccionar
            </p>
            <p className="text-xs text-muted-foreground">
              Solo .xlsx · máx 10 MB · el nombre debe coincidir con la cadena seleccionada
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
      <div className="flex flex-col gap-3">
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
          <div className="space-y-2" aria-live="polite">
            <p className="text-sm text-muted-foreground">
              Procesando archivo… esto toma ~5–10 segundos.
            </p>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full w-1/3 bg-primary animate-pulse rounded-full" />
            </div>
          </div>
        )}
      </div>

      {/* Success summary (per spec §7.2.5 criterion 899) */}
      {success && !isUploading && (
        <div className="rounded-md border border-primary/40 bg-primary/10 p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <CheckCircle2 className="h-5 w-5 text-primary" aria-hidden="true" />
            <span>
              Procesado: {success.chain} · {success.fileType}
            </span>
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

      {/* Error banner with collapsible detail (spec criterion 900) */}
      {failure && !isUploading && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-4 space-y-2"
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
    </Card>
  );
}
