/**
 * lib/upload-limits.ts — shared upload size cap (hardening T2 §2.9).
 *
 * 10MB per file, checked against `File.size` AFTER `req.formData()` (which
 * already materialized the request body in memory) but BEFORE the xlsx
 * parse — which is where the real risk lives. This cap is the accepted
 * interim mitigation for the two unpatched `xlsx` high advisories
 * (prototype pollution / ReDoS need a large crafted workbook to bite — see
 * hardening ledger, T2 triage) and yields a clean 413/error response. On
 * Vercel the request body is already bounded by the platform; on
 * dev/self-host an enormous POST does get buffered before rejection.
 *
 * Boundary is PINNED by the test plan: exactly 10MB passes, one byte over
 * rejects (`size > MAX_UPLOAD_FILE_BYTES`).
 *
 * Consumers: app/api/data/upload/route.ts (per-file, multi-file shape) and
 * app/api/parametros/import/route.ts (single file, 413 + FILE_TOO_LARGE).
 */

export const MAX_UPLOAD_FILE_BYTES = 10 * 1024 * 1024; // 10MB
