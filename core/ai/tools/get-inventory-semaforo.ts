import { tool } from 'ai';
import { getInventorySemaforo } from '../../kpis/queries';
import {
  NO_DATA_RESULT,
  periodInputSchema,
  resolveEffectivePeriod,
  toolExecutionError,
  type ToolRuntime,
} from './context';

export const getInventorySemaforoDescription =
  'Returns the inventory alert status per product and retail chain for one ' +
  'period. Statuses: SIN_STOCK (out of stock), CRITICO, RIESGO, ATENCION, OK, ' +
  'EXCESO (overstock), SIN_DATOS. Use when the user asks which products are ' +
  'at risk, out of stock, overstocked, or about inventory alerts in general.';

export const getInventorySemaforoSchema = periodInputSchema;

export function makeGetInventorySemaforoTool(rt: ToolRuntime) {
  return tool({
    description: getInventorySemaforoDescription,
    inputSchema: getInventorySemaforoSchema,
    execute: async (input) => {
      try {
        const period = await resolveEffectivePeriod(rt, input);
        if (period === null) return NO_DATA_RESULT;
        const cuts = await rt.resolveCuts();
        const rows = await getInventorySemaforo(
          rt.ctx.db,
          { ...input, ...period, clientId: rt.ctx.clientId, userId: rt.ctx.userId },
          cuts,
        );
        return { ...period, rows };
      } catch (err) {
        return toolExecutionError('getInventorySemaforo', err);
      }
    },
  });
}
