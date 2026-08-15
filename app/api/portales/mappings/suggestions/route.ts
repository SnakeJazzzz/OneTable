import { db } from '@/lib/db';
import { requireAuth, errorResponse } from '@/lib/auth-helpers';
import { withRouteErrors } from '@/lib/route-errors';
import { buildMappingSuggestions } from '@/core/fuzzy/suggest';
import { parseChain } from '@/lib/portales/chains';

async function handleGet(req: Request): Promise<Response> {
  const s = await requireAuth();
  if (s instanceof Response) return s;
  const chain = parseChain(new URL(req.url).searchParams.get('chain'));
  if (!chain) return errorResponse('INVALID_CHAIN', 'Unknown chain', 400);
  const result = await buildMappingSuggestions(db, { clientId: s.clientId, chain });
  return Response.json(result);
}

export const GET = withRouteErrors('portales/mappings/suggestions', handleGet);
