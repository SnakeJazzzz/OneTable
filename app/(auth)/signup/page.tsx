'use client';

import { useState, type FormEvent } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

type ApiError = { error?: { code?: string; message?: string } };

const ERROR_COPY: Record<string, string> = {
  EMAIL_TAKEN: 'Ese email ya está registrado',
  INVALID_EMAIL: 'Email inválido',
  INVALID_PASSWORD: 'La contraseña debe tener al menos 6 caracteres',
  INVALID_CLIENT_NAME: 'El nombre de la empresa es requerido',
  INVALID_BODY: 'Datos inválidos',
};

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [clientName, setClientName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const trimmedEmail = email.trim().toLowerCase();
      const trimmedName = clientName.trim();

      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: trimmedEmail,
          password,
          clientName: trimmedName,
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as ApiError;
        const code = body.error?.code ?? '';
        setError(ERROR_COPY[code] ?? 'No se pudo crear la cuenta');
        return;
      }

      // Auto-signIn after successful creation (decision B in G1 brief).
      const signInRes = await signIn('credentials', {
        email: trimmedEmail,
        password,
        redirect: false,
      });

      if (!signInRes || signInRes.error) {
        // The user was created, but auto-login failed for some reason. Send
        // them to /login so they can sign in manually.
        router.push('/login');
        return;
      }
      router.push('/dashboard');
      router.refresh();
    } catch (err) {
      console.error('[signup] submit threw:', err);
      setError('Error al crear cuenta');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Crear cuenta</CardTitle>
          <CardDescription>
            Empezá a consolidar tu sell-out en minutos
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor="clientName">Nombre de la empresa</Label>
              <Input
                id="clientName"
                name="clientName"
                type="text"
                autoComplete="organization"
                required
                minLength={2}
                maxLength={100}
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Contraseña</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
              />
              <p className="text-xs text-muted-foreground">Mínimo 6 caracteres.</p>
            </div>
            {error && (
              <p
                role="alert"
                className="text-sm text-destructive-foreground bg-destructive/10 border border-destructive/40 rounded-md px-3 py-2"
              >
                {error}
              </p>
            )}
            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? 'Procesando...' : 'Crear cuenta'}
            </Button>
            <p className="text-sm text-muted-foreground text-center">
              ¿Ya tenés cuenta?{' '}
              <Link href="/login" className="text-primary hover:underline">
                Iniciar sesión
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
