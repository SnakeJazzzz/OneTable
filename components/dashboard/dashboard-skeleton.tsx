import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';

function Shimmer({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} />;
}

export function DashboardSkeleton() {
  return (
    <div className="p-8 space-y-6" aria-busy="true" aria-label="Cargando dashboard">
      <div className="flex items-center justify-between">
        <Shimmer className="h-8 w-40" />
        <Shimmer className="h-9 w-48" />
      </div>

      {/* 4 KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="p-5 space-y-3">
            <Shimmer className="h-4 w-24" />
            <Shimmer className="h-8 w-32" />
            <Shimmer className="h-3 w-20" />
          </Card>
        ))}
      </div>

      {/* 5 chart placeholders */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="p-5 space-y-3">
            <Shimmer className="h-5 w-40" />
            <Shimmer className="h-64 w-full" />
          </Card>
        ))}
      </div>
      <Card className="p-5 space-y-3">
        <Shimmer className="h-5 w-40" />
        <Shimmer className="h-64 w-full" />
      </Card>
    </div>
  );
}
