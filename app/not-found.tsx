/**
 * app/not-found.tsx — root 404 boundary (hardening T4 §4.6).
 *
 * Server component (no interactivity needed). Rendered inside the root
 * layout, so globals.css and the shadcn tokens ARE available — this uses the
 * app's own Card styling. CTA points to /dashboard: the root `/` only
 * redirects by session (app/page.tsx), so it is not a stable destination.
 * Copy: tuteo mexicano (project rule).
 */

import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <p className="text-sm font-medium text-muted-foreground">Error 404</p>
          <CardTitle>Página no encontrada</CardTitle>
          <CardDescription>
            La página que buscas no existe o fue movida. Revisa la dirección o
            vuelve al inicio.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href="/dashboard"
            className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            Ir al dashboard
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
