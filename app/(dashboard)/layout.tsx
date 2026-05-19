import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { DashboardShell } from '@/components/dashboard/shell';

/**
 * Shared layout for the 5 protected pages. Server component so we can call
 * auth() and Prisma directly. Middleware already redirects unauthenticated
 * traffic, but the second redirect here is a defense in case middleware is
 * ever misconfigured (e.g., matcher change) — auth() returning null on a
 * protected route must always send the user back to /login.
 *
 * Client name is not in the JWT (only clientId), so we resolve it per request.
 * Fase 1 traffic is small; cost-of-query is acceptable. F2 cache option:
 * Next.js `unstable_cache` keyed on session.user.clientId.
 */
export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await auth();
  if (!session?.user?.id || !session.user.clientId) {
    redirect('/login');
  }

  const client = await db.client.findFirst({
    where: { id: session.user.clientId, userId: session.user.id },
    select: { name: true },
  });

  // Stale-token defence: clientId in the JWT no longer belongs to this user.
  // Sign-out and re-auth.
  if (!client) {
    redirect('/login');
  }

  // Defensive narrowing: next-auth.d.ts types email as `string`, but the base
  // NextAuth `Session.user.email` is nullable. Today the Credentials provider
  // always sets email (auth.ts:65, schema enforces non-null), so this fallback
  // only fires if a future provider returns null. Avoids `undefined.charAt(0)`
  // crashes downstream.
  const userEmail = session.user.email ?? '';

  return (
    <DashboardShell userEmail={userEmail} clientName={client.name}>
      {children}
    </DashboardShell>
  );
}
