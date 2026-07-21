import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

// Public health check (hardening T1), polled by the external uptime monitor.
// Excluded from the middleware matcher so each ping skips the auth() wrapper.
// force-dynamic: without it Next would statically optimize this GET at build
// time and the monitor would read a frozen response.
export const dynamic = 'force-dynamic';

// Short timeout so a stalled DB connection yields a fast 503 instead of
// hanging the function until Prisma's own (much longer) connect timeout.
const DB_CHECK_TIMEOUT_MS = 5_000;

export async function GET(): Promise<NextResponse> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      db.$queryRaw`SELECT 1`,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('db health check timeout')),
          DB_CHECK_TIMEOUT_MS,
        );
      }),
    ]);
    return NextResponse.json({ status: 'ok', db: 'up' });
  } catch {
    // Minimal body by design: this endpoint is public, so it must never leak
    // internals (no error messages, versions or hostnames).
    return NextResponse.json({ status: 'error', db: 'down' }, { status: 503 });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
