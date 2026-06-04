/**
 * POST /api/parametros/import — additive, idempotent import of the canonical
 * catalog from an xlsx (§10.1). Delegates all parsing to the pure importer
 * core/parameters/import.ts; this route only handles HTTP concerns:
 *   - auth + clientId resolution,
 *   - multipart parsing + the missing-file-part case (→ 400),
 *   - wrapping the importer in try/catch so a corrupt workbook returns a clean
 *     400 (the pure importer calls XLSX.read which THROWS on a bad buffer; the
 *     importer deliberately delegates that error handling to this route, rather
 *     than 500-ing with a raw stack trace).
 *
 * Auth: required. clientId from the session token.
 */

import { db } from '@/lib/db';
import { requireAuth, errorResponse } from '@/lib/auth-helpers';
import { importParameters } from '@/core/parameters/import';

export async function POST(req: Request): Promise<Response> {
  const sessionOrError = await requireAuth();
  if (sessionOrError instanceof Response) return sessionOrError;
  const { clientId } = sessionOrError;

  let form: FormData;
  try {
    form = await req.formData();
  } catch (err) {
    return errorResponse(
      'INVALID_MULTIPART',
      `Could not parse multipart body: ${err instanceof Error ? err.message : 'unknown'}`,
      400,
    );
  }

  const part = form.get('file');
  if (!(part instanceof File)) {
    return errorResponse('NO_FILE', 'No file in request (field "file")', 400);
  }

  const fileBuffer = Buffer.from(await part.arrayBuffer());

  try {
    const result = await importParameters({ clientId, fileBuffer }, db);
    return Response.json(result);
  } catch (err) {
    // XLSX.read throws on a corrupt / non-xlsx buffer. Surface a 400 with a
    // clear message instead of leaking a 500 + stack trace.
    console.error('[parametros/import] importer error:', err);
    return errorResponse(
      'INVALID_XLSX',
      'No se pudo leer el archivo. Verificá que sea un .xlsx válido.',
      400,
    );
  }
}
