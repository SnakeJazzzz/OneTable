import { db } from '@/lib/db';
import { requireAuth, errorResponse } from '@/lib/auth-helpers';
import { parseChain } from '@/lib/portales/chains';

// GET → all credential rows for the client (username + flags only).
export async function GET(_req: Request): Promise<Response> {
  const s = await requireAuth();
  if (s instanceof Response) return s;
  const credentials = await db.portalCredential.findMany({
    where: { clientId: s.clientId },
    select: { chain: true, username: true, isActive: true, hasPasswordPending: true },
  });
  return Response.json({ credentials });
}

// PUT { chain, username } → upsert. NEVER reads or stores a password (§6.1).
export async function PUT(req: Request): Promise<Response> {
  const s = await requireAuth();
  if (s instanceof Response) return s;
  let body: { chain?: string; username?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse('INVALID_BODY', 'Body must be JSON', 400);
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
