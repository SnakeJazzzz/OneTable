'use client';

import { useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { validateThresholdCuts } from '@/lib/thresholds';
import type { ThresholdCuts } from '@/core/alerts/classify';
import type { UseThresholdsResult } from '@/lib/hooks/use-parametros';

// ---------------------------------------------------------------------------
// Field definitions — rendered in ascending order (critico → exceso)
// ---------------------------------------------------------------------------

type CutKey = keyof ThresholdCuts;

const FIELDS: Array<{ key: CutKey; label: string; hint: string }> = [
  { key: 'critico', label: 'Crítico (días)', hint: 'Por debajo de este valor → alerta crítica.' },
  { key: 'riesgo', label: 'Riesgo (días)', hint: 'Por debajo de este valor → alerta de riesgo.' },
  { key: 'atencion', label: 'Atención (días)', hint: 'Por debajo de este valor → requiere atención.' },
  { key: 'exceso', label: 'Exceso (días)', hint: 'Por encima de este valor → exceso de inventario.' },
];

// ---------------------------------------------------------------------------
// ThresholdsForm
// ---------------------------------------------------------------------------

interface ThresholdsFormProps {
  cuts: ThresholdCuts | null;
  loading: boolean;
  error: string | null;
  saveCuts: UseThresholdsResult['saveCuts'];
}

type FormState = Record<CutKey, string>;

function cutsToForm(cuts: ThresholdCuts): FormState {
  return {
    critico: String(cuts.critico),
    riesgo: String(cuts.riesgo),
    atencion: String(cuts.atencion),
    exceso: String(cuts.exceso),
  };
}

function formToCuts(form: FormState): ThresholdCuts | null {
  const values = {
    critico: parseInt(form.critico, 10),
    riesgo: parseInt(form.riesgo, 10),
    atencion: parseInt(form.atencion, 10),
    exceso: parseInt(form.exceso, 10),
  };
  if (Object.values(values).some(isNaN)) return null;
  return values;
}

export function ThresholdsForm({ cuts, loading, error, saveCuts }: ThresholdsFormProps) {
  const id = useId();

  const [form, setForm] = useState<FormState>({
    critico: '',
    riesgo: '',
    atencion: '',
    exceso: '',
  });

  // Seed form when cuts arrive from the server
  useEffect(() => {
    if (cuts) {
      setForm(cutsToForm(cuts));
    }
  }, [cuts]);

  const [saving, setSaving] = useState(false);
  // Per-field validation error (inline, never a toast) + server error
  const [serverError, setServerError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Compute inline validation on every keystroke
  const parsedCuts = formToCuts(form);
  const validation = parsedCuts ? validateThresholdCuts(parsedCuts) : { ok: false as const, error: 'Ingresá valores enteros en todos los campos.' };

  // Determine which field has the structural error so we show it inline.
  // The error message from validateThresholdCuts is a single string; we show it
  // under the "exceso" field (lowest priority check), but also show a general
  // form-level note so all four fields are visually connected.
  function fieldError(key: CutKey): string | null {
    if (!validation.ok) {
      // Show the error under the first field that could be the culprit based on
      // strict ordering: if critico >= riesgo show under riesgo; if riesgo >=
      // atencion show under atencion; if atencion >= exceso show under exceso.
      // Fallback: show under all when values are non-integer.
      if (parsedCuts === null) {
        // Non-integer — show under the field that's blank/non-number
        const v = parseInt(form[key], 10);
        if (isNaN(v) || form[key].trim() === '') return 'Debe ser un número entero mayor a 0.';
        return null;
      }
      // Structural ordering errors
      const c = parsedCuts;
      if (key === 'riesgo' && c.critico >= c.riesgo) return validation.error;
      if (key === 'atencion' && c.riesgo >= c.atencion) return validation.error;
      if (key === 'exceso' && c.atencion >= c.exceso) return validation.error;
      // All > 0 check
      if (c[key] <= 0) return 'Debe ser mayor a 0.';
    }
    return null;
  }

  function handleChange(key: CutKey, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setServerError(null);
    setSaveSuccess(false);
  }

  async function handleSave() {
    if (!validation.ok || !parsedCuts) return;
    setSaving(true);
    setServerError(null);
    setSaveSuccess(false);
    const result = await saveCuts(parsedCuts);
    setSaving(false);
    if (!result.ok) {
      setServerError(result.message);
    } else {
      setSaveSuccess(true);
      // Update local form from the server response
      setForm(cutsToForm(result.cuts));
    }
  }

  if (loading) {
    return (
      <Card className="p-4">
        <p className="text-sm text-muted-foreground">Cargando umbrales…</p>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="p-4">
        <p role="alert" className="text-sm text-destructive-foreground">{error}</p>
      </Card>
    );
  }

  return (
    <Card className="p-5 space-y-5">
      <p className="text-sm text-muted-foreground">
        Los umbrales definen cuándo un SKU entra en alerta. Deben cumplir: crítico &lt; riesgo &lt; atención &lt; exceso.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {FIELDS.map(({ key, label, hint }) => {
          const err = fieldError(key);
          return (
            <div key={key} className="space-y-1">
              <Label htmlFor={`${id}-${key}`} className="text-sm font-medium">
                {label}
              </Label>
              <Input
                id={`${id}-${key}`}
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={form[key]}
                onChange={(e) => handleChange(key, e.target.value)}
                disabled={saving}
                aria-describedby={err ? `${id}-${key}-err` : `${id}-${key}-hint`}
                className={err ? 'border-destructive focus-visible:ring-destructive' : ''}
              />
              {err ? (
                <p
                  id={`${id}-${key}-err`}
                  role="alert"
                  className="text-xs text-destructive-foreground"
                >
                  {err}
                </p>
              ) : (
                <p id={`${id}-${key}-hint`} className="text-xs text-muted-foreground">
                  {hint}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {serverError && (
        <p role="alert" className="text-sm text-destructive-foreground bg-destructive/10 border border-destructive/40 rounded-md px-3 py-2">
          {serverError}
        </p>
      )}

      {saveSuccess && (
        <p className="text-sm text-primary">Umbrales guardados.</p>
      )}

      <Button
        type="button"
        onClick={handleSave}
        disabled={saving || !validation.ok}
      >
        {saving ? 'Guardando…' : 'Guardar umbrales'}
      </Button>
    </Card>
  );
}
