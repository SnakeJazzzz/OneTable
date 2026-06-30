import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';

export function ConflictBanner({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <div
      role="status"
      className="flex items-center gap-2 rounded-md border border-orange-500/40 bg-orange-500/10 px-4 py-3 text-sm text-orange-200"
    >
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>
        {count === 1 ? '1 portal string en conflicto' : `${count} portal strings en conflicto`}. Resolvelos en{' '}
        <Link href="/portales" className="font-medium underline">
          Portales
        </Link>{' '}
        para que entren al análisis por SKU.
      </span>
    </div>
  );
}
