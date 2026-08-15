import { db } from '@/lib/db';
import { requireAuth, errorResponse } from '@/lib/auth-helpers';
import { withRouteErrors } from '@/lib/route-errors';
import { parseChain } from '@/lib/portales/chains';

// GET → all credential rows for the client (username + flags only).
async function handleGet(_req: Request): Promise<Response> {
  const s = await requireAuth();
  if (s instanceof Response) return s;
  const credentials = await db.portalCredential.findMany({
    where: { clientId: s.clientId },
    select: { chain: true, username: true, isActive: true, hasPasswordPending: true },
  });
  return Response.json({ credentials });
}

// PUT { chain, username } → upsert. NEVER reads or stores a password (§6.1).
async function handlePut(req: Request): Promise<Response> {
  const s = await requireAuth();
  if (s instanceof Response) return s;
  let body: { chain?: string; username?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse('INVALID_BODY', 'Body must be JSON', 400);
  }
  // req.json() resolves for ANY valid JSON (null, "str", 5, [] included);
  // property access on a non-object would TypeError → raw 500. Same guard as
  // price-overrides PUT (T4 §4.5).
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return errorResponse('INVALID_BODY', 'Body must be a JSON object', 400);
  }
  const chain = parseChain(body.chain ?? null);
  if (!chain) return errorResponse('INVALID_CHAIN', 'Unknown chain', 400);
  const username = (body.username ?? '').trim();
  if (!username) return errorResponse('INVALID_USERNAME', 'El usuario es obligatorio.', 400);

  // hasPasswordPending stays true: Fase 2 never captures the password (Fase 3).
  // `update` DELIBERATELY touches only `username`: re-saving credentials must
  // not flip isActive back on — reactivation policy is decided in Fase 3
  // together with the scraping automation.
  await db.portalCredential.upsert({
    where: { clientId_chain: { clientId: s.clientId, chain } },
    create: { clientId: s.clientId, chain, username, isActive: true, hasPasswordPending: true },
    update: { username },
  });
  return Response.json({ ok: true });
}

export const GET = withRouteErrors('portales/credentials', handleGet);
export const PUT = withRouteErrors('portales/credentials', handlePut);
