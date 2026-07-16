// AI chatbot tool layer — public entry point (B5 §9.1, T1).
//
// buildTools produces one ToolSet per request/context. Tool identity
// (name/description/schema) lives at module level in each tool file — stable
// across calls, prompt-caching friendly. Only the execute closures bind to
// the given context. All 7 tools share ONE memoized default-period resolver
// per context (C1).
//
// All tools wrap READ-ONLY queries from core/kpis/queries. Zero mutations,
// zero free-form SQL, zero new queries.
import type { ToolSet } from 'ai';
import { createToolRuntime, type ToolContext } from './context';
import { makeGetDashboardKpisTool } from './get-dashboard-kpis';
import { makeGetSalesTrendTool } from './get-sales-trend';
import { makeGetSalesByChainForPeriodTool } from './get-sales-by-chain';
import { makeGetTopSkusByChainTool } from './get-top-skus';
import { makeGetInventorySemaforoTool } from './get-inventory-semaforo';
import { makeGetOneTableRowsTool } from './get-onetable-rows';
import { makeGetDaysOfInventoryBySkuTool } from './get-days-of-inventory';

export type { PeriodRef, ToolContext, ToolRuntime } from './context';

// `satisfies` (not a `: ToolSet` return annotation): checks assignability
// without widening — consumers keep the per-tool input/output types that
// tool() inferred, instead of a flat Record<string, Tool>.
export function buildTools(ctx: ToolContext) {
  const rt = createToolRuntime(ctx);
  return {
    getDashboardKpis: makeGetDashboardKpisTool(rt),
    getSalesTrend: makeGetSalesTrendTool(rt),
    getSalesByChainForPeriod: makeGetSalesByChainForPeriodTool(rt),
    getTopSkusByChain: makeGetTopSkusByChainTool(rt),
    getInventorySemaforo: makeGetInventorySemaforoTool(rt),
    getOneTableRows: makeGetOneTableRowsTool(rt),
    getDaysOfInventoryBySku: makeGetDaysOfInventoryBySkuTool(rt),
  } satisfies ToolSet;
}
