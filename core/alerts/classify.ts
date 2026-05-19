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
  // H1: Negative values represent accounting adjustments (returns, reconciliation
  // gaps, post-period corrections) — treated as SIN_STOCK because there is no
  // sellable stock. Spec §9.2 pseudocode says `=== 0`; this widens to `<= 0`
  // for runtime robustness against real-world data.
  if (inventoryUnits !== null && inventoryUnits <= 0) return 'SIN_STOCK';
  if (daysOfInventory === null) return 'SIN_DATOS';
  if (daysOfInventory < 7) return 'CRITICO';
  if (daysOfInventory < 14) return 'RIESGO';
  if (daysOfInventory < 21) return 'ATENCION';
  if (daysOfInventory <= 60) return 'OK';
  return 'EXCESO';
}
