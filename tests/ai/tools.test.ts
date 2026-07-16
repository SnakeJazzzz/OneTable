// B5 T1 — AI tool layer tests (brief §4, groups 1-8).
//
// Pure unit tests: core/kpis/queries is vi.mock-ed with spies and the
// threshold-cuts loader is a stub injected via ToolContext.loadCuts (core/
// never imports lib/ — T2 wires the real lib/thresholds loader). Asserts run
// against the exact params each query receives. NEVER against the real AI
// API (CI has no key) and never against the DB.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { ToolCallOptions, ToolSet } from 'ai';
import type { OneTableRow } from '@/core/kpis/queries';
import type { ThresholdCuts } from '@/core/alerts/classify';

vi.mock('@/core/kpis/queries', () => ({
  getDefaultPeriod: vi.fn(),
  getDashboardKpis: vi.fn(),
  getSalesTrend: vi.fn(),
  getSalesByChainForPeriod: vi.fn(),
  getTopSkusByChain: vi.fn(),
  getInventorySemaforo: vi.fn(),
  getOneTableRows: vi.fn(),
  getDaysOfInventoryBySku: vi.fn(),
}));

import {
  getDefaultPeriod,
  getDashboardKpis,
  getSalesTrend,
  getSalesByChainForPeriod,
  getTopSkusByChain,
  getInventorySemaforo,
  getOneTableRows,
  getDaysOfInventoryBySku,
} from '@/core/kpis/queries';
import { buildTools } from '@/core/ai/tools';
import {
  getDashboardKpisDescription,
  getDashboardKpisSchema,
} from '@/core/ai/tools/get-dashboard-kpis';
import { getSalesTrendDescription, getSalesTrendSchema } from '@/core/ai/tools/get-sales-trend';
import {
  getSalesByChainForPeriodDescription,
  getSalesByChainForPeriodSchema,
} from '@/core/ai/tools/get-sales-by-chain';
import { getTopSkusByChainDescription, getTopSkusByChainSchema } from '@/core/ai/tools/get-top-skus';
import {
  getInventorySemaforoDescription,
  getInventorySemaforoSchema,
} from '@/core/ai/tools/get-inventory-semaforo';
import {
  getOneTableRowsDescription,
  getOneTableRowsSchema,
} from '@/core/ai/tools/get-onetable-rows';
import {
  getDaysOfInventoryBySkuDescription,
  getDaysOfInventoryBySkuSchema,
} from '@/core/ai/tools/get-days-of-inventory';

const db = { $queryRaw: vi.fn() } as unknown as PrismaClient;
// Stub of the injected threshold-cuts loader (ToolContext.loadCuts).
const loadCuts = vi.fn<() => Promise<ThresholdCuts>>();
const CTX = { db, clientId: 'client-ctx', userId: 'user-ctx', loadCuts };
const CUTS = { critico: 7, riesgo: 14, atencion: 21, exceso: 60 };
const OPTS: ToolCallOptions = { toolCallId: 'call-1', messages: [] };
const DEFAULT_PERIOD = { periodYear: 2026, periodMonth: 1 };

function makeOneTableRow(i: number): OneTableRow {
  return {
    id: `row-${i}`,
    chain: 'SORIANA',
    storeId: `store-${i}`,
    storeName: `Store ${i}`,
    productId: `prod-${i}`,
    productName: `Product ${i}`,
    portalRawProduct: `RAW ${i}`,
    periodYear: 2026,
    periodMonth: 1,
    salesUnits: 10,
    salesUnitsEstimated: false,
    salesAmountMxn: 100,
    inventoryUnits: 20,
    daysOfInventory: 60,
    alert: 'OK',
    isUnmapped: false,
  };
}

// One entry per tool: schema, a valid input, the underlying query spy, and
// which behaviors apply (period resolution, limit, cuts).
const TOOL_CASES = [
  {
    name: 'getDashboardKpis',
    schema: getDashboardKpisSchema,
    validInput: { periodYear: 2025, periodMonth: 12 },
    query: vi.mocked(getDashboardKpis),
    hasPeriod: true,
    usesCuts: true,
  },
  {
    name: 'getSalesTrend',
    schema: getSalesTrendSchema,
    validInput: { monthsBack: 3 },
    query: vi.mocked(getSalesTrend),
    hasPeriod: false,
    usesCuts: false,
  },
  {
    name: 'getSalesByChainForPeriod',
    schema: getSalesByChainForPeriodSchema,
    validInput: { periodYear: 2025, periodMonth: 12 },
    query: vi.mocked(getSalesByChainForPeriod),
    hasPeriod: true,
    usesCuts: false,
  },
  {
    name: 'getTopSkusByChain',
    schema: getTopSkusByChainSchema,
    validInput: { periodYear: 2025, periodMonth: 12, limit: 5 },
    query: vi.mocked(getTopSkusByChain),
    hasPeriod: true,
    usesCuts: false,
  },
  {
    name: 'getInventorySemaforo',
    schema: getInventorySemaforoSchema,
    validInput: { periodYear: 2025, periodMonth: 12 },
    query: vi.mocked(getInventorySemaforo),
    hasPeriod: true,
    usesCuts: true,
  },
  {
    name: 'getOneTableRows',
    schema: getOneTableRowsSchema,
    validInput: { periodYear: 2025, periodMonth: 12, limit: 5 },
    query: vi.mocked(getOneTableRows),
    hasPeriod: true,
    usesCuts: true,
  },
  {
    name: 'getDaysOfInventoryBySku',
    schema: getDaysOfInventoryBySkuSchema,
    validInput: { periodYear: 2025, periodMonth: 12, limit: 5 },
    query: vi.mocked(getDaysOfInventoryBySku),
    hasPeriod: true,
    usesCuts: false,
  },
] as const;

const PERIOD_CASES = TOOL_CASES.filter((c) => c.hasPeriod);
const CUTS_CASES = TOOL_CASES.filter((c) => c.usesCuts);
const NO_CUTS_CASES = TOOL_CASES.filter((c) => !c.usesCuts);

// Executes a tool from a fresh ToolSet. `input` is passed to the closure
// as-is (tests for injection deliberately bypass schema validation, which is
// exactly what the SDK would NOT do — simulating a validation failure).
async function runTool(
  name: string,
  input: Record<string, unknown>,
  ctx: typeof CTX = CTX,
): Promise<unknown> {
  // Widened to ToolSet on purpose: these tests index by name and feed raw
  // (sometimes deliberately invalid) inputs past the per-tool types.
  const tools: ToolSet = buildTools(ctx);
  return tools[name].execute!(input, OPTS);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getDefaultPeriod).mockResolvedValue({ ...DEFAULT_PERIOD });
  loadCuts.mockResolvedValue({ ...CUTS });
  vi.mocked(getDashboardKpis).mockResolvedValue({
    salesAmountMxn: 1000,
    variationPct: 10,
    salesUnits: 50,
    activeAlertsSkuCount: 2,
  });
  vi.mocked(getSalesTrend).mockResolvedValue([]);
  vi.mocked(getSalesByChainForPeriod).mockResolvedValue([]);
  vi.mocked(getTopSkusByChain).mockResolvedValue([]);
  vi.mocked(getInventorySemaforo).mockResolvedValue([]);
  vi.mocked(getOneTableRows).mockResolvedValue([]);
  vi.mocked(getDaysOfInventoryBySku).mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Group 1 — .strict() rejection of injected keys
// ---------------------------------------------------------------------------

describe('schemas reject injected/unknown keys (.strict)', () => {
  it.each(TOOL_CASES)('$name rejects clientId, userId and junk keys', ({ schema, validInput }) => {
    expect(schema.safeParse(validInput).success).toBe(true);
    expect(schema.safeParse({ ...validInput, clientId: 'evil' }).success).toBe(false);
    expect(schema.safeParse({ ...validInput, userId: 'evil' }).success).toBe(false);
    expect(schema.safeParse({ ...validInput, __garbage: 1 }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Group 2 — injection order: context spread wins over injected args
// ---------------------------------------------------------------------------

describe('execute: context clientId/userId always win (spread order)', () => {
  it.each(TOOL_CASES)(
    '$name passes ctx.clientId/ctx.userId to the query even if args carry injected ones',
    async ({ name, query }) => {
      // Direct closure call with injected identifiers — simulates a bypassed
      // SDK validation. Period provided so getDefaultPeriod stays out of the way.
      const input =
        name === 'getSalesTrend'
          ? { monthsBack: 3, clientId: 'evil-client', userId: 'evil-user' }
          : { periodYear: 2025, periodMonth: 12, clientId: 'evil-client', userId: 'evil-user' };
      await runTool(name, input);

      expect(query).toHaveBeenCalledTimes(1);
      const params = query.mock.calls[0][1] as { clientId: string; userId: string };
      expect(params.clientId).toBe('client-ctx');
      expect(params.userId).toBe('user-ctx');
    },
  );
});

// ---------------------------------------------------------------------------
// Group 3 — schema defaults, caps, and the both-or-neither period pair (C2)
// ---------------------------------------------------------------------------

describe('schema defaults and caps', () => {
  const LIMIT_SCHEMAS = [
    ['getTopSkusByChain', getTopSkusByChainSchema],
    ['getOneTableRows', getOneTableRowsSchema],
    ['getDaysOfInventoryBySku', getDaysOfInventoryBySkuSchema],
  ] as const;

  it.each(LIMIT_SCHEMAS)('%s: limit defaults to 20 and caps at 50', (_name, schema) => {
    const parsed = schema.safeParse({});
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.limit).toBe(20);
    expect(schema.safeParse({ limit: 50 }).success).toBe(true);
    expect(schema.safeParse({ limit: 51 }).success).toBe(false);
    expect(schema.safeParse({ limit: 0 }).success).toBe(false);
    expect(schema.safeParse({ limit: 10.5 }).success).toBe(false);
  });

  it('monthsBack defaults to 6, bounded 1..24', () => {
    const parsed = getSalesTrendSchema.safeParse({});
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.monthsBack).toBe(6);
    expect(getSalesTrendSchema.safeParse({ monthsBack: 24 }).success).toBe(true);
    expect(getSalesTrendSchema.safeParse({ monthsBack: 25 }).success).toBe(false);
    expect(getSalesTrendSchema.safeParse({ monthsBack: 0 }).success).toBe(false);
  });

  it.each(PERIOD_CASES)('$name rejects out-of-range period values', ({ schema }) => {
    expect(schema.safeParse({ periodYear: 2025, periodMonth: 13 }).success).toBe(false);
    expect(schema.safeParse({ periodYear: 2025, periodMonth: 0 }).success).toBe(false);
    expect(schema.safeParse({ periodYear: 1999, periodMonth: 6 }).success).toBe(false);
  });

  it.each(PERIOD_CASES)('$name (C2): half-provided period pair is rejected', ({ schema }) => {
    expect(schema.safeParse({ periodYear: 2025 }).success).toBe(false);
    expect(schema.safeParse({ periodMonth: 12 }).success).toBe(false);
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ periodYear: 2025, periodMonth: 12 }).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Group 4 — payload cap in the wrapper (D-1)
// ---------------------------------------------------------------------------

describe('payload cap for queries without native limit (D-1)', () => {
  it('getOneTableRows slices to limit and reports totalRows', async () => {
    const sixty = Array.from({ length: 60 }, (_, i) => makeOneTableRow(i));
    vi.mocked(getOneTableRows).mockResolvedValue(sixty);

    const result = (await runTool('getOneTableRows', {
      periodYear: 2025,
      periodMonth: 12,
      limit: 50,
    })) as { rows: OneTableRow[]; totalRows: number };

    expect(result.rows).toHaveLength(50);
    expect(result.totalRows).toBe(60);
    expect(result.rows[0].id).toBe('row-0');
  });

  it('getOneTableRows falls back to the default cap of 20 when limit is absent', async () => {
    const sixty = Array.from({ length: 60 }, (_, i) => makeOneTableRow(i));
    vi.mocked(getOneTableRows).mockResolvedValue(sixty);

    const result = (await runTool('getOneTableRows', {
      periodYear: 2025,
      periodMonth: 12,
    })) as { rows: OneTableRow[]; limit: number };

    expect(result.limit).toBe(20);
    expect(result.rows).toHaveLength(20);
  });

  it('getDaysOfInventoryBySku slices to limit and reports totalRows', async () => {
    const rows = Array.from({ length: 55 }, (_, i) => ({
      productName: `P${i}`,
      chain: 'SORIANA' as const,
      daysOfInventory: i,
    }));
    vi.mocked(getDaysOfInventoryBySku).mockResolvedValue(rows);

    const result = (await runTool('getDaysOfInventoryBySku', {
      periodYear: 2025,
      periodMonth: 12,
      limit: 10,
    })) as { rows: unknown[]; totalRows: number };

    expect(result.rows).toHaveLength(10);
    expect(result.totalRows).toBe(55);
  });

  it('getTopSkusByChain passes limit natively to the query (no wrapper slice needed)', async () => {
    await runTool('getTopSkusByChain', { periodYear: 2025, periodMonth: 12, limit: 7 });
    const params = vi.mocked(getTopSkusByChain).mock.calls[0][1];
    expect(params.limit).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// Group 5 — period resolution (D-3), echo (C1-a), memoization (C1-b),
//           NO_DATA (C3)
// ---------------------------------------------------------------------------

describe('period resolution', () => {
  it.each(PERIOD_CASES)(
    '$name resolves the default period when none is provided and echoes it (C1-a)',
    async ({ name, query }) => {
      const result = (await runTool(name, {})) as Record<string, unknown>;

      expect(getDefaultPeriod).toHaveBeenCalledTimes(1);
      expect(getDefaultPeriod).toHaveBeenCalledWith(db, {
        clientId: 'client-ctx',
        userId: 'user-ctx',
      });
      const params = query.mock.calls[0][1] as { periodYear: number; periodMonth: number };
      expect(params.periodYear).toBe(2026);
      expect(params.periodMonth).toBe(1);
      // Echo of the effectively used (default-resolved) period.
      expect(result.periodYear).toBe(2026);
      expect(result.periodMonth).toBe(1);
    },
  );

  it.each(PERIOD_CASES)(
    '$name uses the provided period as-is, echoes it, and never calls getDefaultPeriod',
    async ({ name, query }) => {
      const result = (await runTool(name, { periodYear: 2025, periodMonth: 7 })) as Record<
        string,
        unknown
      >;

      expect(getDefaultPeriod).not.toHaveBeenCalled();
      const params = query.mock.calls[0][1] as { periodYear: number; periodMonth: number };
      expect(params.periodYear).toBe(2025);
      expect(params.periodMonth).toBe(7);
      expect(result.periodYear).toBe(2025);
      expect(result.periodMonth).toBe(7);
    },
  );

  it('(C1-b) memoizes getDefaultPeriod across tools of the SAME context', async () => {
    const tools = buildTools(CTX);
    await tools.getDashboardKpis.execute!({}, OPTS);
    await tools.getSalesByChainForPeriod.execute!({}, OPTS);
    await tools.getInventorySemaforo.execute!({}, OPTS);

    expect(getDefaultPeriod).toHaveBeenCalledTimes(1);
  });

  it('(C1-b) a fresh context resolves its own default period', async () => {
    await runTool('getDashboardKpis', {});
    await runTool('getDashboardKpis', {}); // new buildTools → new context
    expect(getDefaultPeriod).toHaveBeenCalledTimes(2);
  });

  it.each(PERIOD_CASES)(
    "$name (C3): client without data returns {error: 'NO_DATA'} and skips the query",
    async ({ name, query }) => {
      vi.mocked(getDefaultPeriod).mockResolvedValue(null);

      const result = await runTool(name, {});

      expect(result).toEqual({ error: 'NO_DATA' });
      expect(query).not.toHaveBeenCalled();
    },
  );

  it('getSalesTrend does not resolve nor echo a period (anchored query by design)', async () => {
    const result = (await runTool('getSalesTrend', { monthsBack: 3 })) as Record<string, unknown>;
    expect(getDefaultPeriod).not.toHaveBeenCalled();
    expect(result.periodYear).toBeUndefined();
    expect(result.monthsBack).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Group 6 — threshold cuts wiring
// ---------------------------------------------------------------------------

describe('threshold cuts', () => {
  it.each(CUTS_CASES)(
    '$name loads cuts via the injected ctx.loadCuts and passes them to the query',
    async ({ name, query }) => {
      await runTool(name, { periodYear: 2025, periodMonth: 12 });

      expect(loadCuts).toHaveBeenCalledTimes(1);
      expect(query.mock.calls[0][2]).toEqual(CUTS);
    },
  );

  it.each(NO_CUTS_CASES)('$name does not load threshold cuts', async ({ name }) => {
    await runTool(
      name,
      name === 'getSalesTrend' ? { monthsBack: 3 } : { periodYear: 2025, periodMonth: 12 },
    );
    expect(loadCuts).not.toHaveBeenCalled();
  });

  it('memoizes loadCuts across tools of the SAME context', async () => {
    const tools = buildTools(CTX);
    await tools.getDashboardKpis.execute!({ periodYear: 2025, periodMonth: 12 }, OPTS);
    await tools.getInventorySemaforo.execute!({ periodYear: 2025, periodMonth: 12 }, OPTS);
    await tools.getOneTableRows.execute!({ periodYear: 2025, periodMonth: 12, limit: 5 }, OPTS);

    expect(loadCuts).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Group 6-bis — memoized resolvers: rejection is NOT cached, concurrent calls
//               share one in-flight resolution (fix pass minors 1-2)
// ---------------------------------------------------------------------------

describe('memoized resolvers: retry after rejection, single flight under concurrency', () => {
  it('period resolver: a rejected resolution is not cached — the next call retries and succeeds', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(getDefaultPeriod)
      .mockRejectedValueOnce(new Error('transient neon hiccup'))
      .mockResolvedValueOnce({ ...DEFAULT_PERIOD });
    const tools = buildTools(CTX);

    const first = await tools.getDashboardKpis.execute!({}, OPTS);
    expect(first).toEqual({ error: 'TOOL_EXECUTION_ERROR' });

    const second = (await tools.getDashboardKpis.execute!({}, OPTS)) as Record<string, unknown>;
    expect(second.periodYear).toBe(2026);
    expect(second.periodMonth).toBe(1);
    // The underlying resolver ran twice: the rejection was not cached.
    expect(getDefaultPeriod).toHaveBeenCalledTimes(2);
  });

  it('cuts resolver: a rejected resolution is not cached — the next call retries and succeeds', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    loadCuts
      .mockRejectedValueOnce(new Error('transient neon hiccup'))
      .mockResolvedValueOnce({ ...CUTS });
    const tools = buildTools(CTX);
    const input = { periodYear: 2025, periodMonth: 12 };

    const first = await tools.getDashboardKpis.execute!(input, OPTS);
    expect(first).toEqual({ error: 'TOOL_EXECUTION_ERROR' });

    const second = (await tools.getDashboardKpis.execute!(input, OPTS)) as Record<string, unknown>;
    expect(second.salesAmountMxn).toBe(1000);
    expect(loadCuts).toHaveBeenCalledTimes(2);
  });

  it('period resolver: two concurrent executes share ONE in-flight resolution', async () => {
    let release!: (v: typeof DEFAULT_PERIOD) => void;
    vi.mocked(getDefaultPeriod).mockImplementation(
      () =>
        new Promise((res) => {
          release = res;
        }),
    );
    const tools = buildTools(CTX);

    // Both executes call the resolver synchronously (before the first await
    // settles), so this exercises the true concurrent path.
    const inFlight = Promise.all([
      tools.getDashboardKpis.execute!({}, OPTS),
      tools.getSalesByChainForPeriod.execute!({}, OPTS),
    ]);
    release({ ...DEFAULT_PERIOD });
    await inFlight;

    expect(getDefaultPeriod).toHaveBeenCalledTimes(1);
  });

  it('cuts resolver: two concurrent executes share ONE in-flight resolution', async () => {
    let release!: (v: ThresholdCuts) => void;
    loadCuts.mockImplementation(
      () =>
        new Promise((res) => {
          release = res;
        }),
    );
    const tools = buildTools(CTX);
    const input = { periodYear: 2025, periodMonth: 12 };

    const inFlight = Promise.all([
      tools.getDashboardKpis.execute!(input, OPTS),
      tools.getInventorySemaforo.execute!(input, OPTS),
    ]);
    // Flush microtasks so BOTH executes get past the (already-resolved)
    // period await and are blocked on the cuts promise before it is released
    // — this pins the truly-concurrent path.
    for (let i = 0; i < 5; i++) await Promise.resolve();
    release({ ...CUTS });
    await inFlight;

    expect(loadCuts).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Group 7 — error path: generic shape, no Prisma leakage
// ---------------------------------------------------------------------------

describe('error handling', () => {
  const SENSITIVE = 'P1001 cannot reach db at ep-secret-neon-host-12345.aws.neon.tech';

  it.each(TOOL_CASES)(
    "$name: query failure returns {error: 'TOOL_EXECUTION_ERROR'} without leaking the message",
    async ({ name, query }) => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      query.mockRejectedValue(new Error(SENSITIVE));

      const input =
        name === 'getSalesTrend' ? { monthsBack: 3 } : { periodYear: 2025, periodMonth: 12 };
      const result = await runTool(name, input);

      expect(result).toEqual({ error: 'TOOL_EXECUTION_ERROR' });
      expect(JSON.stringify(result)).not.toContain('neon');
      // The server-side log is allowed but must carry no data payload either.
      expect(JSON.stringify(consoleSpy.mock.calls)).not.toContain('neon');
    },
  );

  it('server-side log includes the error code when present, still without the message', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Prisma-like error: a .code property (distinct from anything in the
    // message, so the assert below unambiguously proves the code path).
    const prismaLike = Object.assign(new Error(SENSITIVE), { code: 'P2024' });
    vi.mocked(getDashboardKpis).mockRejectedValue(prismaLike);

    const result = await runTool('getDashboardKpis', { periodYear: 2025, periodMonth: 12 });

    expect(result).toEqual({ error: 'TOOL_EXECUTION_ERROR' });
    const logged = JSON.stringify(consoleSpy.mock.calls);
    expect(logged).toContain('P2024'); // code is logged for debuggability
    expect(logged).not.toContain('neon'); // the sensitive message still is not
    expect(JSON.stringify(result)).not.toContain('P2024'); // and never reaches the model
  });

  it('getDefaultPeriod failure is a TOOL_EXECUTION_ERROR, not NO_DATA', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(getDefaultPeriod).mockRejectedValue(new Error(SENSITIVE));

    const result = await runTool('getDashboardKpis', {});

    expect(result).toEqual({ error: 'TOOL_EXECUTION_ERROR' });
  });

  it('loadCuts failure is a TOOL_EXECUTION_ERROR', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    loadCuts.mockRejectedValue(new Error(SENSITIVE));

    const result = await runTool('getDashboardKpis', { periodYear: 2025, periodMonth: 12 });

    expect(result).toEqual({ error: 'TOOL_EXECUTION_ERROR' });
  });

  it('NO_DATA and TOOL_EXECUTION_ERROR remain distinguishable shapes', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.mocked(getDefaultPeriod).mockResolvedValue(null);
    const noData = await runTool('getDashboardKpis', {});

    vi.mocked(getDefaultPeriod).mockResolvedValue({ ...DEFAULT_PERIOD });
    vi.mocked(getDashboardKpis).mockRejectedValue(new Error('boom'));
    const genericError = await runTool('getDashboardKpis', {});

    expect(noData).toEqual({ error: 'NO_DATA' });
    expect(genericError).toEqual({ error: 'TOOL_EXECUTION_ERROR' });
    expect(noData).not.toEqual(genericError);
  });
});

// ---------------------------------------------------------------------------
// Group 8 — stable identity across buildTools calls (prompt caching)
// ---------------------------------------------------------------------------

describe('tool identity is stable across contexts', () => {
  // Independent source of truth: the module-level consts each tool file
  // exports. Comparing both builds AGAINST these (instead of against each
  // other) makes the assert effective — a build that stopped binding the
  // module-level identity would fail even if both builds drifted together.
  const EXPECTED_IDENTITY = {
    getDashboardKpis: {
      description: getDashboardKpisDescription,
      inputSchema: getDashboardKpisSchema,
    },
    getSalesTrend: {
      description: getSalesTrendDescription,
      inputSchema: getSalesTrendSchema,
    },
    getSalesByChainForPeriod: {
      description: getSalesByChainForPeriodDescription,
      inputSchema: getSalesByChainForPeriodSchema,
    },
    getTopSkusByChain: {
      description: getTopSkusByChainDescription,
      inputSchema: getTopSkusByChainSchema,
    },
    getInventorySemaforo: {
      description: getInventorySemaforoDescription,
      inputSchema: getInventorySemaforoSchema,
    },
    getOneTableRows: {
      description: getOneTableRowsDescription,
      inputSchema: getOneTableRowsSchema,
    },
    getDaysOfInventoryBySku: {
      description: getDaysOfInventoryBySkuDescription,
      inputSchema: getDaysOfInventoryBySkuSchema,
    },
  } as const;

  it('two buildTools calls expose the module-level name/description/schema, not per-build copies', () => {
    const ctxB = { db, clientId: 'client-b', userId: 'user-b', loadCuts };
    const toolsA: ToolSet = buildTools(CTX);
    const toolsB: ToolSet = buildTools(ctxB);

    // Names: both builds expose exactly the expected tool names.
    expect(Object.keys(toolsA)).toEqual(Object.keys(EXPECTED_IDENTITY));
    expect(Object.keys(toolsB)).toEqual(Object.keys(EXPECTED_IDENTITY));

    for (const [name, expected] of Object.entries(EXPECTED_IDENTITY)) {
      expect(toolsA[name].description).toBe(expected.description);
      expect(toolsB[name].description).toBe(expected.description);
      // Schemas by REFERENCE: the exact module-level const, stable across
      // builds (prompt caching).
      expect(toolsA[name].inputSchema).toBe(expected.inputSchema);
      expect(toolsB[name].inputSchema).toBe(expected.inputSchema);
      // Only the execute closure varies per context.
      expect(toolsA[name].execute).not.toBe(toolsB[name].execute);
    }
  });

  it('each closure routes to its own context', async () => {
    const ctxB = { db, clientId: 'client-b', userId: 'user-b', loadCuts };
    const toolsA = buildTools(CTX);
    const toolsB = buildTools(ctxB);

    await toolsA.getSalesByChainForPeriod.execute!({ periodYear: 2025, periodMonth: 12 }, OPTS);
    await toolsB.getSalesByChainForPeriod.execute!({ periodYear: 2025, periodMonth: 12 }, OPTS);

    const calls = vi.mocked(getSalesByChainForPeriod).mock.calls;
    expect((calls[0][1] as { clientId: string }).clientId).toBe('client-ctx');
    expect((calls[1][1] as { clientId: string }).clientId).toBe('client-b');
  });
});
