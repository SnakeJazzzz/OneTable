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
import { MAX_UPLOAD_FILE_BYTES } from '@/lib/upload-limits';

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

  // 10MB cap (T2 §2.9), checked on `part.size` after formData() (the body
  // is already in memory at this point) but BEFORE the xlsx parse, which is
  // where the real risk lives (unpatched xlsx advisories). Status 413 +
  // FILE_TOO_LARGE are pinned by the brief; the `{ error: { code, message } }`
  // shape follows the repo convention (errorResponse in lib/auth-helpers.ts,
  // same as the sibling responses in this route).
  if (part.size > MAX_UPLOAD_FILE_BYTES) {
    return errorResponse(
      'FILE_TOO_LARGE',
      'El archivo supera el límite de 10 MB.',
      413,
    );
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
