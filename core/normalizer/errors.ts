/**
 * core/normalizer/errors.ts — typed error family for the resolve services
 * (hardening T4 §4.3).
 *
 * Replaces the substring-matching contract between core/normalizer/resolve.ts
 * and app/api/portales/mappings/route.ts: routes now branch on
 * `e instanceof ServiceError` + `e.code` instead of `e.message.includes(...)`.
 * Core stays pure — no Next.js imports, no HTTP status knowledge here; the
 * code → status/copy mapping lives in the route.
 *
 * The parser/catalog/dates throw families deliberately do NOT migrate: their
 * messages are part of the per-file upload/import contract (T5 decides that
 * copy's language).
 */

export type ServiceErrorCode =
  /** deleteMapping/retargetMapping: the (client, chain, string, product) mapping row does not exist. */
  | 'MAPPING_NOT_FOUND'
  /** deleteMapping/retargetMapping: the mapping is CONFLICTED — resolve via the conflict UI. */
  | 'MAPPING_CONFLICTED'
  /** retargetMapping: newProductId equals oldProductId (no-op retarget prohibited). */
  | 'NOOP_RETARGET'
  /** retargetMapping: newProductId does not exist or belongs to another client. */
  | 'PRODUCT_NOT_FOUND'
  /** requeueUnmappedProduct: no firstSeenUploadId to re-anchor the string (route pre-checks anticipate it; defense in depth). */
  | 'MISSING_UPLOAD_ANCHOR'
  /** resolveConflict: winnerProductId is not one of the conflict's candidates (route pre-checks anticipate it; defense in depth). */
  | 'INVALID_WINNER';

export class ServiceError extends Error {
  constructor(
    public readonly code: ServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}
