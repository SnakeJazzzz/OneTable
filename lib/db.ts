import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

// Single client per process. In Next.js dev mode HMR would otherwise spawn one
// client per reload, exhausting the connection pool.
export const db = globalThis.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalThis.prisma = db;
