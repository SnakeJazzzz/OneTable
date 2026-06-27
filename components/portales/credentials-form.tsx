'use client';

import { useEffect, useState } from 'react';
import type { Chain } from '@prisma/client';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

export function CredentialsForm({ chain, initialUsername }: { chain: Chain; initialUsername: string }) {
  const [username, setUsername] = useState(initialUsername);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // FIX #3: re-sync field if parent re-fetches and passes a new initialUsername
  useEffect(() => {
    setUsername(initialUsername);
    setSaved(false);
    setError(null);
  }, [initialUsername]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setUsername(e.target.value);
    // Clear stale saved/error whenever user edits
    setSaved(false);
    setError(null);
  }

  async function save() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch('/api/portales/credentials', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chain, username }),
      });
      if (!res.ok) throw new Error(`Error al guardar (${res.status})`);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor={`user-${chain}`}>Usuario del portal</Label>
        <Input id={`user-${chain}`} value={username} onChange={handleChange} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`pass-${chain}`} className="text-muted-foreground">Contraseña</Label>
        <Input
          id={`pass-${chain}`}
          type="password"
          disabled
          placeholder="Se solicitará al activar la automatización (Fase 3)"
        />
        <p className="text-xs text-muted-foreground">
          No guardamos la contraseña en Fase 2. Se solicitará al activar la automatización (Fase 3).
        </p>
      </div>
      <Button type="button" onClick={save} disabled={saving || !username.trim()}>
        {saving ? 'Guardando…' : 'Guardar usuario'}
      </Button>
      {saved && (
        <p className="text-sm text-primary">Usuario guardado ✓</p>
      )}
      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
