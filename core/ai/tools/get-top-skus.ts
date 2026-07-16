import { tool } from 'ai';
import { getTopSkusByChain } from '../../kpis/queries';
import {
  DEFAULT_LIMIT,
  NO_DATA_RESULT,
  periodWithLimitInputSchema,
  resolveEffectivePeriod,
  toolExecutionError,
  type ToolRuntime,
} from './context';

export const getTopSkusByChainDescription =
  'Returns the top products by units sold within each retail chain for one ' +
  'period. Use when the user asks for best sellers, top SKUs, or the most ' +
  'sold products per chain.';

export const getTopSkusByChainSchema = periodWithLimitInputSchema;

export function makeGetTopSkusByChainTool(rt: ToolRuntime) {
  return tool({
    description: getTopSkusByChainDescription,
    inputSchema: getTopSkusByChainSchema,
    execute: async (input) => {
      try {
        const period = await resolveEffectivePeriod(rt, input);
        if (period === null) return NO_DATA_RESULT;
        // ?? guard: a direct closure call may bypass schema defaults.
        const limit = input.limit ?? DEFAULT_LIMIT;
        // limit is native to this query (top N per chain).
        const rows = await getTopSkusByChain(rt.ctx.db, {
          ...input,
          ...period,
          limit,
          clientId: rt.ctx.clientId,
          userId: rt.ctx.userId,
        });
        return { ...period, limit, rows };
      } catch (err) {
        return toolExecutionError('getTopSkusByChain', err);
      }
    },
  });
}
