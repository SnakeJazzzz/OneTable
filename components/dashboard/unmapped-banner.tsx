import Link from 'next/link';
import { AlertTriangle, ArrowRight } from 'lucide-react';

export function UnmappedBanner({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <div
      role="status"
      className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between rounded-md border border-yellow-500/40 bg-yellow-500/10 px-4 py-3"
    >
      <div className="flex items-center gap-2 text-sm text-yellow-200">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>
          {count === 1
            ? '1 producto sin mapear afecta la calidad del dashboard.'
            : `${count} productos sin mapear afectan la calidad del dashboard.`}
        </span>
      </div>
      <Link
        href="/catalogo"
        className="inline-flex items-center gap-1 text-sm font-medium text-yellow-200 hover:text-yellow-100 underline-offset-2 hover:underline"
      >
        Resolver en Catálogo
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </div>
  );
}
