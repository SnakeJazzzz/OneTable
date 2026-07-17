import { tool } from 'ai';
import { getDashboardKpis } from '../../kpis/queries';
import {
  NO_DATA_RESULT,
  periodInputSchema,
  resolveEffectivePeriod,
  toolExecutionError,
  type ToolRuntime,
} from './context';

// name/description/schema live at module level: stable tool identity across
// buildTools calls (prompt caching) — only the execute closure varies.
export const getDashboardKpisDescription =
  'Returns the four dashboard KPIs for one period: total sales amount in MXN, ' +
  'percentage variation vs the previous month, total units sold, and the count ' +
  'of SKUs with active inventory alerts. Use when the user asks about overall ' +
  'sales performance, monthly totals, month-over-month change, or how many ' +
  'products are in alert.';

export const getDashboardKpisSchema = periodInputSchema;

export function makeGetDashboardKpisTool(rt: ToolRuntime) {
  return tool({
    description: getDashboardKpisDescription,
    inputSchema: getDashboardKpisSchema,
    execute: async (input) => {
      try {
        const period = await resolveEffectivePeriod(rt, input);
        if (period === null) return NO_DATA_RESULT;
        const cuts = await rt.resolveCuts();
        const kpis = await getDashboardKpis(
          rt.ctx.db,
          // Context spread LAST: ctx.clientId/ctx.userId always win, even if
          // schema validation were somehow bypassed (defense in depth).
          { ...input, ...period, clientId: rt.ctx.clientId, userId: rt.ctx.userId },
          cuts,
        );
        // C1: echo the period actually used (provided or default-resolved) so
        // the model always knows which month it is answering about.
        return { ...period, ...kpis };
      } catch (err) {
        return toolExecutionError('getDashboardKpis', err);
      }
    },
  });
}
