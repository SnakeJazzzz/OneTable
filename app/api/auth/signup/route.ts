/**
 * POST /api/auth/signup — create User + Client atomically (G1).
 *
 * Fase 1 multi-tenancy invariant: every User MUST own at least 1 Client. The
 * Credentials authorize() in auth.ts rejects login when clients.length === 0
 * and returns null silently. To keep that invariant unbreakable, signup uses
 * Prisma's nested create so User + Client are persisted in a single
 * transaction. If creation fails midway, neither row exists.
 *
 * Auto-signIn is performed client-side by the signup page after this route
 * returns 200 (two round-trips). Server-side signIn() from a route handler is
 * harder to wire to the auth cookie reliably, so we keep the route purely
 * about row creation.
 */

import { hash } from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { errorResponse } from '@/lib/auth-helpers';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 10;
// bcrypt silently truncates input beyond 72 BYTES (not chars — multibyte
// passwords hit it earlier). Truncation would mean two different passwords
// verify as equal, so we REJECT over-long passwords instead (T2 §2.8).
// Existing users are untouched — this only gates new signups.
const MAX_PASSWORD_BYTES = 72;
const MIN_CLIENT_NAME = 2;
const MAX_CLIENT_NAME = 100;
const BCRYPT_ROUNDS = 10;

type SignupBody = {
  email?: unknown;
  password?: unknown;
  clientName?: unknown;
};

export async function POST(req: Request): Promise<Response> {
  let body: SignupBody;
  try {
    body = (await req.json()) as SignupBody;
  } catch {
    return errorResponse('INVALID_BODY', 'Body must be JSON', 400);
  }

  const emailRaw = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const clientNameRaw = typeof body.clientName === 'string' ? body.clientName.trim() : '';

  if (!emailRaw || !EMAIL_RE.test(emailRaw)) {
    return errorResponse('INVALID_EMAIL', 'Email inválido', 400);
  }
  if (!password || password.length < MIN_PASSWORD) {
    return errorResponse(
      'INVALID_PASSWORD',
      `Tu contraseña debe tener al menos ${MIN_PASSWORD} caracteres`,
      400,
    );
  }
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
    return errorResponse(
      'PASSWORD_TOO_LONG',
      `Tu contraseña es demasiado larga (máximo ${MAX_PASSWORD_BYTES} bytes)`,
      400,
    );
  }
  if (
    !clientNameRaw ||
    clientNameRaw.length < MIN_CLIENT_NAME ||
    clientNameRaw.length > MAX_CLIENT_NAME
  ) {
    return errorResponse(
      'INVALID_CLIENT_NAME',
      `Nombre de empresa debe tener entre ${MIN_CLIENT_NAME} y ${MAX_CLIENT_NAME} caracteres`,
      400,
    );
  }

  try {
    const passwordHash = await hash(password, BCRYPT_ROUNDS);

    // Nested create → User + Client in one transaction. If Client creation
    // fails (constraint violation, OOM mid-write, etc.) Prisma rolls back the
    // User insert too. This is the only way to guarantee the auth.ts:56
    // invariant (`user.clients.length > 0`) on every persisted User.
    const user = await db.user.create({
      data: {
        email: emailRaw,
        passwordHash,
        clients: {
          create: { name: clientNameRaw, thresholdConfig: { create: {} } },
        },
      },
      select: {
        id: true,
        email: true,
        clients: { select: { id: true, name: true } },
      },
    });

    return Response.json(
      {
        ok: true,
        user: { id: user.id, email: user.email },
        client: user.clients[0],
      },
      { status: 200 },
    );
  } catch (err) {
    // P2002 = unique constraint violation. The only unique field involved is
    // User.email, so this can only mean "email already taken".
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return errorResponse('EMAIL_TAKEN', 'Email ya registrado', 409);
    }
    // Anything else: log server-side, return generic 500 to the client.
    console.error('[signup] unexpected error:', err);
    return errorResponse('INTERNAL_ERROR', 'Error al crear cuenta', 500);
  }
}
