/**
 * app/error.tsx — root error boundary (hardening T4 §4.6).
 *
 * 'use client' is Next's contract for error boundaries. Catches throws from
 * server pages/layouts below the root layout — in practice the dashboard
 * layout's DB read (§1.8 of the T4 brief) is the dominant real case (DB
 * down). The root layout itself survived, so globals.css and the shadcn
 * tokens ARE available here.
 *
 * No technical details reach the user: only `error.digest` (Next's opaque
 * server-error reference, safe to show) as a short support reference.
 * Copy: tuteo mexicano (project rule).
 */

'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <CardTitle>Algo salió mal</CardTitle>
          <CardDescription>
            Ocurrió un error inesperado. Intenta de nuevo; si el problema
            persiste, contáctanos.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-3">
          <Button onClick={reset}>Intentar de nuevo</Button>
          {error.digest ? (
            <p className="text-xs text-muted-foreground">Referencia: {error.digest}</p>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
