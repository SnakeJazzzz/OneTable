/**
 * POST /api/data/upload — multipart upload of 1+ portal xlsx files.
 *
 * Body: multipart/form-data with one or more `files` parts. Optional
 * top-level `chain` and `fileType` form fields set the chain/fileType
 * explicitly (Portales cards know their chain, §3.2.4). When both explicit
 * fields are absent, chain+fileType fall back to filename detection
 * (back-compat for callers that don't send explicit fields).
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
 * Chain/fileType resolution: explicit `chain`+`fileType` form fields win;
 * filename detection is the fallback. If explicit fields are present but
 * fail validation (unknown chain, invalid fileType, or only one of the two
 * provided), a per-file error is returned — we do NOT silently fall back to
 * filename detection (that would mask bad input). Unmatched filenames or
 * invalid explicit values surface in the per-file response with
 * `{ error: ... }` — we DON'T 400 the whole request unless every file
 * failed (otherwise a 4-file upload with 1 typo would lose 3 successful
 * imports).
 */

import { createHash } from 'node:crypto';
import type { Chain, FileType } from '@prisma/client';

import { db } from '@/lib/db';
import { requireAuth, errorResponse } from '@/lib/auth-helpers';
import { getParser } from '@/core/parsers/registry';
import { normalize } from '@/core/normalizer';
import { buildMappingLookup } from '@/core/normalizer/lookup';
import type { MappingLookup } from '@/core/normalizer/types';
import { parseChain, parseFileType } from '@/lib/portales/chains';

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

  // Read optional explicit chain/fileType at request level (§3.2.4).
  // Explicit fields win over filename detection. If exactly one field is
  // provided, or if either field fails enum validation, the error is surfaced
  // per-file — NOT silently fallen back to filename detection.
  const rawChain = form.get('chain');
  const rawFileType = form.get('fileType');

  let explicit: { chain: Chain; fileType: FileType } | null = null;
  let explicitError: string | null = null;

  if (rawChain !== null || rawFileType !== null) {
    // At least one explicit field was sent → require both and validate.
    const chainStr = rawChain instanceof File ? null : rawChain;
    const fileTypeStr = rawFileType instanceof File ? null : rawFileType;
    const parsedChain = parseChain(chainStr);
    const parsedFileType = parseFileType(fileTypeStr);
    if (parsedChain !== null && parsedFileType !== null) {
      explicit = { chain: parsedChain, fileType: parsedFileType };
    } else {
      const issues: string[] = [];
      // A File in a metadata field is a caller bug distinct from an absent
      // field — reporting it as "missing" misleads whoever debugs the client.
      if (rawChain instanceof File) issues.push('chain field must be a plain text value, not a file');
      else if (chainStr === null) issues.push('chain field missing');
      else if (parsedChain === null) issues.push(`unknown chain: "${chainStr}"`);
      if (rawFileType instanceof File) issues.push('fileType field must be a plain text value, not a file');
      else if (fileTypeStr === null) issues.push('fileType field missing');
      else if (parsedFileType === null) issues.push(`unknown fileType: "${fileTypeStr}"`);
      explicitError = `invalid explicit upload metadata: ${issues.join('; ')}`;
    }
  }

  // Pre-resolve the mapping lookup once (§8.3 union — reads CONFLICTED state).
  // The set of chains touched depends on the files in this request; over-
  // fetching all chain mappings for this client is cheap (<100 rows in F1) and
  // avoids re-querying per file.
  const mappings = await db.productMapping.findMany({
    where: { clientId },
    select: { chain: true, portalString: true, productId: true, status: true },
  });
  const mappingLookup = buildMappingLookup(mappings);

  // Process files sequentially. See file-level comment for rationale.
  const perFile: PerFile[] = [];
  for (const file of fileEntries) {
    perFile.push(await processOneFile(file, { clientId, userId, mappingLookup, explicit, explicitError }));
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
    mappingLookup: MappingLookup;
    // Explicit chain/fileType from the request (wins over filename detection).
    // null → use filename detection (back-compat). explicitError is set when
    // the caller sent explicit fields that failed enum validation.
    explicit: { chain: Chain; fileType: FileType } | null;
    explicitError: string | null;
  },
): Promise<PerFile> {
  // If explicit fields were sent but failed validation, surface the error.
  // Do NOT silently fall back to filename detection — that would mask bad input.
  if (ctx.explicitError !== null) {
    return { filename: file.name, error: ctx.explicitError };
  }

  // Explicit wins; filename detection is the back-compat fallback.
  const resolved = ctx.explicit ?? detectUpload(file.name);
  if (!resolved) {
    return {
      filename: file.name,
      error:
        'unknown file type — expected filename to match soriana, chedraui, amazon ventas, or amazon inv',
    };
  }

  const parser = getParser(resolved.chain, resolved.fileType);
  if (!parser) {
    return {
      filename: file.name,
      error: `no parser registered for ${resolved.chain}/${resolved.fileType}`,
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
      chain: resolved.chain,
      fileType: resolved.fileType,
      originalFilename: file.name,
      fileHash,
      fileSizeBytes: buffer.length,
      status: 'PROCESSING',
    },
  });

  try {
    const parsed = await parser.parse({
      buffer,
      fileType: resolved.fileType,
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
      chain: resolved.chain,
      fileType: resolved.fileType,
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
