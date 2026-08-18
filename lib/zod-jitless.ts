// Force zod's non-JIT parse path to keep the CSP eval-free (T6 Tanda A).
//
// WHY: zod 4.3.6 feature-detects eval support via `util.allowsEval`
// (`try { new Function("") }`). Under our CSP (script-src without
// 'unsafe-eval') that probe triggers a REAL violation report even though
// the exception is caught — captured in the T4/T5 smokes from the
// /analisis vendor chunk (`34-09a2e5143d5aa06c.js:16:36104`), fired from
// both /analisis and /dashboard. zod reaches the client bundle through
// the chat stack (ai -> @ai-sdk/provider-utils -> zod).
//
// With `jitless: true`, the JIT gate in `$ZodObject`
// (node_modules/zod/v4/core/schemas.js:901-918) short-circuits
// (`const jit = !core.globalConfig.jitless; ... jit && allowsEval.value`)
// so the probe is never even evaluated: zero `Function`, zero violation.
//
// UNCONDITIONAL on purpose (no `typeof window` guard — Michael's
// decision, 2026-08-17): jitless applies wherever THIS module evaluates —
// the client bundle and the SSR pass of /analisis. The chat API route
// never imports this module and keeps zod's own default; marginal cost
// accepted, zero functional change, one less branch to test.
//
// Ledger pointer: `.superpowers/sdd/hardening-backlog.md`, CORTE punto 2,
// eval-del-chunk-34 item (~lines 63-82).
//
// WARNING — DO NOT REORDER IMPORTS in files importing this module. ES
// modules evaluate depth-first, so this module must be the FIRST import
// of any client entry that pulls zod (today: chat-panel.tsx) to run
// `z.config` before any zod schema is constructed or parsed. Import
// sorters are the typical way this breaks.

import { z } from 'zod';

z.config({ jitless: true });
