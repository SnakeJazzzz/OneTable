import { tool } from 'ai';
import { getOneTableRows } from '../../kpis/queries';
import {
  DEFAULT_LIMIT,
  NO_DATA_RESULT,
  periodWithLimitInputSchema,
  resolveEffectivePeriod,
  toolExecutionError,
  type ToolRuntime,
} from './context';

export const getOneTableRowsDescription =
  'Returns detailed per-store rows for one period: chain, store, product, ' +
  'units sold, sales amount in MXN, inventory units, days of inventory, and ' +
  'alert status. The response is capped at `limit` rows; `totalRows` reports ' +
  'how many rows exist in total. Use when the user asks for store-level or ' +
  'row-level detail.';

export const getOneTableRowsSchema = periodWithLimitInputSchema;

export function makeGetOneTableRowsTool(rt: ToolRuntime) {
  return tool({
    description: getOneTableRowsDescription,
    inputSchema: getOneTableRowsSchema,
    execute: async (input) => {
      try {
        const period = await resolveEffectivePeriod(rt, input);
        if (period === null) return NO_DATA_RESULT;
        // ?? guard: a direct closure call may bypass schema defaults.
        const limit = input.limit ?? DEFAULT_LIMIT;
        const cuts = await rt.resolveCuts();
        const rows = await getOneTableRows(
          rt.ctx.db,
          { ...input, ...period, clientId: rt.ctx.clientId, userId: rt.ctx.userId },
          cuts,
        );
        // D-1: the underlying query has no limit param (~3,188 real rows per
        // period). The cap is applied here, in the wrapper — DB cost is
        // unchanged, but the payload sent to the model stays bounded.
        // totalRows lets the model verbalize the truncation.
        return {
          ...period,
          limit,
          totalRows: rows.length,
          rows: rows.slice(0, limit),
        };
      } catch (err) {
        return toolExecutionError('getOneTableRows', err);
      }
    },
  });
}
