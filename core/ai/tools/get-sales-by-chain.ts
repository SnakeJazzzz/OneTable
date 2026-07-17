import { tool } from 'ai';
import { getSalesByChainForPeriod } from '../../kpis/queries';
import {
  NO_DATA_RESULT,
  periodInputSchema,
  resolveEffectivePeriod,
  toolExecutionError,
  type ToolRuntime,
} from './context';

// D-2: not in the spec §9.1.1 catalog, added as 7th tool per approved brief —
// direct money query ("how much did I sell per chain this month?").
export const getSalesByChainForPeriodDescription =
  'Returns total sales (amount in MXN and units sold) grouped by retail chain ' +
  'for one period. Use when the user asks how much was sold in each chain in ' +
  'a given month, or which chain sold the most.';

export const getSalesByChainForPeriodSchema = periodInputSchema;

export function makeGetSalesByChainForPeriodTool(rt: ToolRuntime) {
  return tool({
    description: getSalesByChainForPeriodDescription,
    inputSchema: getSalesByChainForPeriodSchema,
    execute: async (input) => {
      try {
        const period = await resolveEffectivePeriod(rt, input);
        if (period === null) return NO_DATA_RESULT;
        const rows = await getSalesByChainForPeriod(rt.ctx.db, {
          ...input,
          ...period,
          clientId: rt.ctx.clientId,
          userId: rt.ctx.userId,
        });
        return { ...period, rows };
      } catch (err) {
        return toolExecutionError('getSalesByChainForPeriod', err);
      }
    },
  });
}
