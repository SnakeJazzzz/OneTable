import { tool } from 'ai';
import { z } from 'zod';
import { getSalesTrend } from '../../kpis/queries';
import { toolExecutionError, type ToolRuntime } from './context';

export const getSalesTrendDescription =
  'Returns monthly sales per retail chain (sales amount in MXN, units sold, ' +
  'inventory units) for the last N months, anchored to the most recent month ' +
  'with data. Use when the user asks about sales evolution, trends over time, ' +
  'or comparing chains across months.';

// No period input by design: the underlying query anchors itself to the
// latest period present in the data.
export const getSalesTrendSchema = z.strictObject({
  monthsBack: z
    .number()
    .int()
    .min(1)
    .max(24)
    .default(6)
    .describe(
      'How many months back to include, counted from the most recent month with data (1-24, default 6).',
    ),
});

export function makeGetSalesTrendTool(rt: ToolRuntime) {
  return tool({
    description: getSalesTrendDescription,
    inputSchema: getSalesTrendSchema,
    execute: async (input) => {
      try {
        // ?? guard: a direct closure call may bypass schema defaults.
        const monthsBack = input.monthsBack ?? 6;
        const rows = await getSalesTrend(rt.ctx.db, {
          ...input,
          monthsBack,
          clientId: rt.ctx.clientId,
          userId: rt.ctx.userId,
        });
        return { monthsBack, rows };
      } catch (err) {
        return toolExecutionError('getSalesTrend', err);
      }
    },
  });
}
