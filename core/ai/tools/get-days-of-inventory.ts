import { tool } from 'ai';
import { getDaysOfInventoryBySku } from '../../kpis/queries';
import {
  DEFAULT_LIMIT,
  NO_DATA_RESULT,
  periodWithLimitInputSchema,
  resolveEffectivePeriod,
  toolExecutionError,
  type ToolRuntime,
} from './context';

export const getDaysOfInventoryBySkuDescription =
  'Returns the days of inventory per product and retail chain for one period, ' +
  'using the most-at-risk store per product (lowest days). 0 means out of ' +
  'stock today; null means no signal (no sales). The response is capped at ' +
  '`limit` rows; `totalRows` reports how many exist. Use when the user asks ' +
  'how long inventory will last or which products will run out soonest.';

export const getDaysOfInventoryBySkuSchema = periodWithLimitInputSchema;

export function makeGetDaysOfInventoryBySkuTool(rt: ToolRuntime) {
  return tool({
    description: getDaysOfInventoryBySkuDescription,
    inputSchema: getDaysOfInventoryBySkuSchema,
    execute: async (input) => {
      try {
        const period = await resolveEffectivePeriod(rt, input);
        if (period === null) return NO_DATA_RESULT;
        // ?? guard: a direct closure call may bypass schema defaults.
        const limit = input.limit ?? DEFAULT_LIMIT;
        const rows = await getDaysOfInventoryBySku(rt.ctx.db, {
          ...input,
          ...period,
          clientId: rt.ctx.clientId,
          userId: rt.ctx.userId,
        });
        // Cap applied in the wrapper (the query has no limit param) — same
        // rationale as getOneTableRows (D-1).
        return {
          ...period,
          limit,
          totalRows: rows.length,
          rows: rows.slice(0, limit),
        };
      } catch (err) {
        return toolExecutionError('getDaysOfInventoryBySku', err);
      }
    },
  });
}
