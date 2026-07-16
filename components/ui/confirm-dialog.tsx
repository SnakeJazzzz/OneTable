'use client';

import { useEffect, useId, useRef } from 'react';
import { Button } from './button';
import { cn } from '@/lib/utils';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** Optional error text rendered between description and buttons (e.g. from a failed action). */
  errorMessage?: string | null;
  loading?: boolean;
  /** Confirm-button label while loading. Defaults to 'Borrando…' (the original callers delete). */
  loadingLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancelar',
  errorMessage,
  loading,
  loadingLabel = 'Borrando…',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Close on Escape (unless loading).
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) onCancel();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, loading, onCancel]);

  // Focus management: remember the trigger, focus the dialog on open, restore on close.
  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => {
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-xl outline-none"
      >
        <h2 id={titleId} className="text-lg font-bold text-foreground">
          {title}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>

        {errorMessage && (
          <p
            role="alert"
            className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground"
          >
            {errorMessage}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <Button
            onClick={onCancel}
            disabled={loading}
            className={cn(
              'bg-muted text-foreground hover:bg-muted/80 focus-visible:ring-muted',
            )}
          >
            {cancelLabel}
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={loading}>
            {loading ? loadingLabel : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
