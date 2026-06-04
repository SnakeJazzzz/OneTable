export type AlertStatus =
  | 'SIN_STOCK'
  | 'CRITICO'
  | 'RIESGO'
  | 'ATENCION'
  | 'OK'
  | 'EXCESO'
  | 'SIN_DATOS';

export type ThresholdCuts = {
  critico: number; // days < critico → CRITICO
  riesgo: number; // days < riesgo   → RIESGO
  atencion: number; // days < atencion → ATENCION
  exceso: number; // days <= exceso  → OK; days > exceso → EXCESO
};

// The Fase 1 hardcoded bands, now the fallback when a Client has no
// ThresholdConfig row. Matches the ThresholdConfig column defaults (spec §4.5).
export const DEFAULT_CUTS: ThresholdCuts = {
  critico: 7,
  riesgo: 14,
  atencion: 21,
  exceso: 60,
};

export function classifyAlert(
  inventoryUnits: number | null,
  daysOfInventory: number | null,
  cuts: ThresholdCuts,
): AlertStatus {
  // H1: Negative values represent accounting adjustments (returns, reconciliation
  // gaps, post-period corrections) — treated as SIN_STOCK because there is no
  // sellable stock. Spec §9.2 pseudocode says `=== 0`; this widens to `<= 0`
  // for runtime robustness against real-world data.
  if (inventoryUnits !== null && inventoryUnits <= 0) return 'SIN_STOCK';
  if (daysOfInventory === null) return 'SIN_DATOS';
  if (daysOfInventory < cuts.critico) return 'CRITICO';
  if (daysOfInventory < cuts.riesgo) return 'RIESGO';
  if (daysOfInventory < cuts.atencion) return 'ATENCION';
  if (daysOfInventory <= cuts.exceso) return 'OK';
  return 'EXCESO';
}
