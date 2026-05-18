export type AlertStatus =
  | 'SIN_STOCK'
  | 'CRITICO'
  | 'RIESGO'
  | 'ATENCION'
  | 'OK'
  | 'EXCESO'
  | 'SIN_DATOS';

export function classifyAlert(
  inventoryUnits: number | null,
  daysOfInventory: number | null,
): AlertStatus {
  if (inventoryUnits === 0) return 'SIN_STOCK';
  if (daysOfInventory === null) return 'SIN_DATOS';
  if (daysOfInventory < 7) return 'CRITICO';
  if (daysOfInventory < 14) return 'RIESGO';
  if (daysOfInventory < 21) return 'ATENCION';
  if (daysOfInventory <= 60) return 'OK';
  return 'EXCESO';
}
