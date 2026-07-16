// AI chatbot tool layer — shared context + helpers (B5 §9.1, T1).
//
// core/ stays pure: no Next.js/NextAuth imports AND no lib/ imports (the
// repo's layering is lib→core, never core→lib — core/ must stay extractable
// to Python/FastAPI in Fase 3). The PrismaClient and the threshold-cuts
// loader are injected through ToolContext (same pattern as core/kpis/queries
// — testable without a running app). The route (T2) builds the context from
// requireAuth() and wires loadCuts from lib/thresholds.
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { ThresholdCuts } from '../../alerts/classify';
import { getDefaultPeriod } from '../../kpis/queries';

export type ToolContext = {
  db: PrismaClient;
  clientId: string;
  userId: string;
  // Raw loader for the client's ThresholdCuts. Injected by the caller (T2
  // builds it from lib/thresholds' getThresholdCuts) so core/ never imports
  // lib/. Named loadCuts — distinct from ToolRuntime.resolveCuts (memoized) —
  // so calling the raw loader where the memoized one is meant no longer
  // compiles the same.
  loadCuts: () => Promise<ThresholdCuts>;
};

export type PeriodRef = { periodYear: number; periodMonth: number };

// Runtime handed to each tool factory by buildTools: the request context plus
// MEMOIZED resolvers (C1) for the default period and the threshold cuts. The
// first call hits the underlying resolver once; every later call — from ANY
// tool bound to the same context — reuses the same promise (including
// concurrent calls: the promise is cached synchronously). Zero period queries
// if the user specified the period in every tool call.
export type ToolRuntime = {
  ctx: ToolContext;
  resolveDefaultPeriod: () => Promise<PeriodRef | null>;
  resolveCuts: () => Promise<ThresholdCuts>;
};

// Memoizes by promise (concurrent callers share one in-flight call) but never
// caches a REJECTION: if the cached promise rejects, the cache is cleared so
// the next call retries. A transient failure (e.g. a Neon hiccup) must not
// poison every later tool call of the same turn.
function memoizeResolver<T>(fn: () => Promise<T>): () => Promise<T> {
  let cached: Promise<T> | null = null;
  return () => {
    if (cached === null) {
      const inflight = fn();
      cached = inflight;
      inflight.catch(() => {
        if (cached === inflight) cached = null;
      });
    }
    return cached;
  };
}

export function createToolRuntime(ctx: ToolContext): ToolRuntime {
  return {
    ctx,
    resolveDefaultPeriod: memoizeResolver(() =>
      getDefaultPeriod(ctx.db, {
        clientId: ctx.clientId,
        userId: ctx.userId,
      }),
    ),
    resolveCuts: memoizeResolver(() => ctx.loadCuts()),
  };
}

// ---------------------------------------------------------------------------
// Shared input schema pieces
// ---------------------------------------------------------------------------
//
// clientId/userId are NEVER part of any schema — they come exclusively from
// the server-side context. All schemas are strict: an unknown key (including
// clientId/userId injected via prompt injection) is a hard reject, not a
// silent strip.

const PERIOD_FIELDS = {
  periodYear: z
    .number()
    .int()
    .min(2000)
    .max(2100)
    .optional()
    .describe(
      'Year of the period to query (e.g. 2026). Provide together with periodMonth, or omit both to use the most recent period with data.',
    ),
  periodMonth: z
    .number()
    .int()
    .min(1)
    .max(12)
    .optional()
    .describe(
      'Month of the period to query (1-12). Provide together with periodYear, or omit both to use the most recent period with data.',
    ),
};

// C2: periodYear/periodMonth are both-or-neither. A half-provided pair is a
// schema-level reject, never a silent guess.
const bothOrNeitherPeriod = (v: { periodYear?: number; periodMonth?: number }) =>
  (v.periodYear === undefined) === (v.periodMonth === undefined);

const PERIOD_PAIR_MESSAGE =
  'Provide periodYear and periodMonth together, or omit both to use the most recent period with data.';

// Schema for tools whose only input is the (optional) period.
export const periodInputSchema = z
  .strictObject({ ...PERIOD_FIELDS })
  .refine(bothOrNeitherPeriod, { message: PERIOD_PAIR_MESSAGE });

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 50;

// Schema for list tools: period + limit (default 20, max 50 — payload cap so
// large result sets never flood the model context).
export const periodWithLimitInputSchema = z
  .strictObject({
    ...PERIOD_FIELDS,
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_LIMIT)
      .default(DEFAULT_LIMIT)
      .describe(`Maximum number of rows to return (1-${MAX_LIMIT}, default ${DEFAULT_LIMIT}).`),
  })
  .refine(bothOrNeitherPeriod, { message: PERIOD_PAIR_MESSAGE });

export type PeriodInput = z.output<typeof periodInputSchema>;
export type PeriodWithLimitInput = z.output<typeof periodWithLimitInputSchema>;

// ---------------------------------------------------------------------------
// Execute helpers
// ---------------------------------------------------------------------------

// D-3: if the model provided both period params, use them as-is; otherwise
// resolve the client's default period (memoized, same default the dashboard
// uses — S12.1). null → the client has no data at all → callers return
// NO_DATA_RESULT.
export function resolveEffectivePeriod(
  rt: ToolRuntime,
  input: { periodYear?: number; periodMonth?: number },
): Promise<PeriodRef | null> {
  if (input.periodYear !== undefined && input.periodMonth !== undefined) {
    return Promise.resolve({
      periodYear: input.periodYear,
      periodMonth: input.periodMonth,
    });
  }
  return rt.resolveDefaultPeriod();
}

// C3: valid business outcome, NOT an execution failure — the client has no
// SelloutData yet, so no default period exists. Distinct shape from
// TOOL_EXECUTION_ERROR so the model can verbalize "no data loaded yet".
export const NO_DATA_RESULT = { error: 'NO_DATA' } as const;

// Generic execution failure. NEVER leak Prisma/Neon messages or stacks into
// the tool result (it would flow straight into the model stream). The
// server-side log carries no data payload — tool name + error class + error
// code (when present, e.g. Prisma P-codes) only; never the message.
export function toolExecutionError(
  toolName: string,
  err: unknown,
): { error: 'TOOL_EXECUTION_ERROR' } {
  const kind = err instanceof Error ? err.name : typeof err;
  const code =
    typeof err === 'object' && err !== null
      ? (err as { code?: unknown }).code
      : undefined;
  const suffix = typeof code === 'string' ? `/${code}` : '';
  console.error(`[ai-tools] ${toolName} failed (${kind}${suffix})`);
  return { error: 'TOOL_EXECUTION_ERROR' };
}
