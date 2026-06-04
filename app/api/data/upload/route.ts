/**
 * POST /api/data/upload — multipart upload of 1+ portal xlsx files.
 *
 * Body: multipart/form-data with one or more `files` parts. Each file's chain
 * + fileType is inferred from its filename (no manual selector in S12 — the
 * frontend can pre-validate names; the server is the source of truth).
 *
 * For each file we:
 *   1. Compute sha256 hash + size.
 *   2. Create an Upload row (status=PENDING) so we have an id to dangle the
 *      SelloutData rows from.
 *   3. Parse via the chain-specific PortalParser.
 *   4. Build the mapping lookup ONCE (per clientId+chain set across all files
 *      we plan to process) and pass to normalize() as a closure.
 *   5. Run normalize() → batched UPSERT into SelloutData + UnmappedProduct.
 *   6. Update the Upload row with status=COMPLETED + per-row stats.
 *
 * Files are processed SEQUENTIALLY, not in parallel. normalize() wraps the
 * whole upload in a 120s `$transaction`; running multiple transactions in
 * parallel starves the Neon pool (default 10 concurrent connections) and
 * produces opaque "ConnectionAcquireTimeoutError"s in production.
 *
 * Discovery #1 from S11: Amazon ventas + Amazon inv share the same UPSERT
 * key (chain + storeId=NULL + portalRawProduct + period). The second Amazon
 * file processed will show `inserted=0, updated=N` — that's the COALESCE
 * merge working, not a failure. The response separates `rowsInserted` from
 * `rowsUpdated` so the frontend can render "N rows merged" instead of
 * misleading "0 inserted".
 *
 * Auth: required. 401 with `{ error: { code: 'UNAUTHORIZED', message } }` if
 * no session. clientId + userId taken from the JWT.
 *
 * File detection: by lowercased filename. Unmatched filenames are returned
 * in the per-file response with `{ error: 'unknown file type' }` — we DON'T
 * 400 the whole request unless every file was unmatched (otherwise a
 * 4-file upload with 1 typo would lose 3 successful imports).
 */

import { createHash } from 'node:crypto';
import type { Chain, FileType } from '@prisma/client';

import { db } from '@/lib/db';
import { requireAuth, errorResponse } from '@/lib/auth-helpers';
import { getParser } from '@/core/parsers/registry';
import { normalize } from '@/core/normalizer';

// =====================================================================
// File detection
// =====================================================================

type DetectedUpload = { chain: Chain; fileType: FileType };

function detectUpload(filename: string): DetectedUpload | null {
  const lower = filename.toLowerCase();
  // Amazon ventas/inv must come BEFORE the generic amazon check; ventas is
  // most-specific so we test it first.
  if (/amazon.*ventas/.test(lower)) {
    return { chain: 'AMAZON', fileType: 'VENTAS' };
  }
  if (/amazon.*inv/.test(lower)) {
    return { chain: 'AMAZON', fileType: 'INVENTARIO' };
  }
  if (/soriana/.test(lower)) {
    return { chain: 'SORIANA', fileType: 'MIXED' };
  }
  if (/chedraui/.test(lower)) {
    return { chain: 'CHEDRAUI', fileType: 'MIXED' };
  }
  return null;
}

// =====================================================================
// Per-file response shape
// =====================================================================

type PerFileSuccess = {
  filename: string;
  chain: Chain;
  fileType: FileType;
  uploadId: string;
  rowsTotal: number;
  rowsInserted: number;
  rowsUpdated: number;
  rowsUnmapped: number;
  newUnmappedProducts: number;
  warnings: string[];
  elapsedMs: number;
};

type PerFileFailure = {
  filename: string;
  error: string;
};

type PerFile = PerFileSuccess | PerFileFailure;

// =====================================================================
// Handler
// =====================================================================

export async function POST(req: Request): Promise<Response> {
  const sessionOrError = await requireAuth();
  if (sessionOrError instanceof Response) return sessionOrError;
  const { clientId, userId } = sessionOrError;

  // Parse multipart body. Next.js App Router supports this natively; no
  // formidable / busboy needed.
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

  // Accept files under either `files` (multi) or `file` (single).
  const fileEntries: File[] = [];
  for (const value of form.getAll('files')) {
    if (value instanceof File) fileEntries.push(value);
  }
  for (const value of form.getAll('file')) {
    if (value instanceof File) fileEntries.push(value);
  }
  if (fileEntries.length === 0) {
    return errorResponse('NO_FILES', 'No files in request (use field name "files")', 400);
  }

  // Pre-resolve the mapping lookup once. The set of chains touched depends on
  // the files in this request; over-fetching all chain mappings for this
  // client is cheap (<100 rows in F1) and avoids re-querying per file.
  const mappings = await db.productMapping.findMany({
    where: { clientId },
    select: { chain: true, portalString: true, productId: true },
  });
  const lookupMap = new Map<string, string>(
    mappings.map((m) => [`${m.chain}:${m.portalString}`, m.productId]),
  );
  const mappingLookup = (chain: Chain, portalString: string): string | null =>
    lookupMap.get(`${chain}:${portalString}`) ?? null;

  // Process files sequentially. See file-level comment for rationale.
  const perFile: PerFile[] = [];
  for (const file of fileEntries) {
    perFile.push(await processOneFile(file, { clientId, userId, mappingLookup }));
  }

  // If every file failed detection, surface a 400 — that's a request-level
  // mistake (wrong field, all-wrong filenames), not a partial success.
  const anySuccess = perFile.some((p): p is PerFileSuccess => !('error' in p));
  if (!anySuccess) {
    return Response.json(
      {
        error: { code: 'ALL_FILES_FAILED', message: 'No files could be processed' },
        perFile,
      },
      { status: 400 },
    );
  }

  return Response.json({ perFile });
}

// =====================================================================
// Per-file pipeline (kept small — easier to test/log mid-stream)
// =====================================================================

async function processOneFile(
  file: File,
  ctx: {
    clientId: string;
    userId: string;
    mappingLookup: (chain: Chain, portalString: string) => string | null;
  },
): Promise<PerFile> {
  const detected = detectUpload(file.name);
  if (!detected) {
    return {
      filename: file.name,
      error:
        'unknown file type — expected filename to match soriana, chedraui, amazon ventas, or amazon inv',
    };
  }

  const parser = getParser(detected.chain, detected.fileType);
  if (!parser) {
    return {
      filename: file.name,
      error: `no parser registered for ${detected.chain}/${detected.fileType}`,
    };
  }

  const t0 = Date.now();
  const buffer = Buffer.from(await file.arrayBuffer());
  const fileHash = createHash('sha256').update(buffer).digest('hex');

  // Create Upload row first so SelloutData has an id to FK to.
  const uploadRow = await db.upload.create({
    data: {
      clientId: ctx.clientId,
      userId: ctx.userId,
      chain: detected.chain,
      fileType: detected.fileType,
      originalFilename: file.name,
      fileHash,
      fileSizeBytes: buffer.length,
      status: 'PROCESSING',
    },
  });

  try {
    const parsed = await parser.parse({
      buffer,
      fileType: detected.fileType,
      originalFilename: file.name,
    });

    const stats = await normalize(
      {
        clientId: ctx.clientId,
        userId: ctx.userId,
        uploadId: uploadRow.id,
        parserResult: parsed,
        mappingLookup: ctx.mappingLookup,
      },
      db,
    );

    await db.upload.update({
      where: { id: uploadRow.id },
      data: {
        status: 'COMPLETED',
        processedAt: new Date(),
        rowsTotal: stats.rowsTotal,
        rowsInserted: stats.rowsInserted,
        rowsUpdated: stats.rowsUpdated,
        rowsUnmapped: stats.rowsUnmapped,
      },
    });

    return {
      filename: file.name,
      chain: detected.chain,
      fileType: detected.fileType,
      uploadId: uploadRow.id,
      rowsTotal: stats.rowsTotal,
      rowsInserted: stats.rowsInserted,
      rowsUpdated: stats.rowsUpdated,
      rowsUnmapped: stats.rowsUnmapped,
      newUnmappedProducts: stats.newUnmappedProducts,
      warnings: stats.warnings,
      elapsedMs: Date.now() - t0,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    // Don't leak full stack traces in JSON; do persist in the Upload row.
    await db.upload
      .update({
        where: { id: uploadRow.id },
        data: { status: 'FAILED', errorMessage: message, processedAt: new Date() },
      })
      .catch(() => {
        // Swallow secondary failure — the primary error is what the user sees.
      });
    return { filename: file.name, error: message };
  }
}
