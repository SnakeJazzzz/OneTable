/**
 * /api/parametros/thresholds — read + update the client's alert threshold cuts.
 *
 *   GET → the client's cuts ({ critico, riesgo, atencion, exceso }) via
 *         getThresholdCuts (falls back to DEFAULT_CUTS defensively).
 *   PUT → validate the proposed cuts SERVER-SIDE (never trust the client) with
 *         validateThresholdCuts, then upsert the ThresholdConfig row.
 *
 * Auth: required. clientId from the session token.
 *
 * The ThresholdConfig row exists from signup (B1 §4.5); the upsert is defensive
 * so a missing row (direct DB caller, pre-B1 client) still produces one.
 */

import { db } from '@/lib/db';
import { requireAuth, errorResponse } from '@/lib/auth-helpers';
import { withRouteErrors } from '@/lib/route-errors';
import { getThresholdCuts, validateThresholdCuts } from '@/lib/thresholds';
import type { ThresholdCuts } from '@/core/alerts/classify';

type PutThresholdsBody = {
  critico?: unknown;
  riesgo?: unknown;
  atencion?: unknown;
  exceso?: unknown;
};

function toNumber(raw: unknown): number {
  // Accept number or numeric string; anything non-finite becomes NaN, which
  // validateThresholdCuts rejects (Number.isInteger(NaN) === false).
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string' && raw.trim() !== '') return Number(raw);
  return NaN;
}

async function handleGet(): Promise<Response> {
  const sessionOrError = await requireAuth();
  if (sessionOrError instanceof Response) return sessionOrError;
  const { clientId } = sessionOrError;

  const cuts = await getThresholdCuts(db, clientId);
  return Response.json({ cuts });
}

async function handlePut(req: Request): Promise<Response> {
  const sessionOrError = await requireAuth();
  if (sessionOrError instanceof Response) return sessionOrError;
  const { clientId } = sessionOrError;

  let body: PutThresholdsBody;
  try {
    body = (await req.json()) as PutThresholdsBody;
  } catch {
    return errorResponse('INVALID_BODY', 'Body must be JSON', 400);
  }

  // req.json() resolves for ANY valid JSON (null, "str", 5, [] included);
  // property access on a non-object would TypeError → raw 500. Same guard as
  // price-overrides PUT (T4 §4.5).
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return errorResponse('INVALID_BODY', 'Body must be a JSON object', 400);
  }

  const cuts: ThresholdCuts = {
    critico: toNumber(body.critico),
    riesgo: toNumber(body.riesgo),
    atencion: toNumber(body.atencion),
    exceso: toNumber(body.exceso),
  };

  const validation = validateThresholdCuts(cuts);
  if (!validation.ok) {
    return errorResponse('INVALID_THRESHOLDS', validation.error, 422);
  }

  await db.thresholdConfig.upsert({
    where: { clientId },
    create: {
      clientId,
      criticoDays: cuts.critico,
      riesgoDays: cuts.riesgo,
      atencionDays: cuts.atencion,
      excesoDays: cuts.exceso,
    },
    update: {
      criticoDays: cuts.critico,
      riesgoDays: cuts.riesgo,
      atencionDays: cuts.atencion,
      excesoDays: cuts.exceso,
    },
  });

  return Response.json({ cuts });
}

export const GET = withRouteErrors('parametros/thresholds', handleGet);
export const PUT = withRouteErrors('parametros/thresholds', handlePut);
