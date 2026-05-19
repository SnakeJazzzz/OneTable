import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

function Placeholder({ className }: { className?: string }) {
  return <div className={cn('rounded-md bg-muted/40', className)} />;
}

export function DashboardEmpty() {
  return (
    <div className="p-8 space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold text-foreground">Dashboard</h1>
        <p className="text-muted-foreground">
          Subí tu primer archivo en Análisis para ver tus KPIs.
        </p>
        <Link href="/analisis">
          <Button className="mt-2 gap-2">
            Ir a Análisis
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </Link>
      </header>

      <div
        className="space-y-6 opacity-50"
        aria-hidden="true"
        data-testid="dashboard-empty-skeleton"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="p-5 space-y-3">
              <Placeholder className="h-4 w-24" />
              <Placeholder className="h-8 w-32" />
            </Card>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="p-5 space-y-3">
              <Placeholder className="h-5 w-40" />
              <Placeholder className="h-64 w-full" />
            </Card>
          ))}
        </div>
        <Card className="p-5 space-y-3">
          <Placeholder className="h-5 w-40" />
          <Placeholder className="h-64 w-full" />
        </Card>
      </div>
    </div>
  );
}
