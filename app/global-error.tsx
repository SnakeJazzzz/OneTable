/**
 * app/global-error.tsx — last-resort boundary when the ROOT LAYOUT itself
 * throws (hardening T4 §4.6).
 *
 * Next's contract: this replaces the entire document, so it must render its
 * own <html>/<body>. SELF-CONTAINED styles by design: if the root layout
 * died, the globals.css import may never have reached the page, so no
 * Tailwind classes here — inline style objects only, with the app's dark
 * theme values hardcoded (mirrors the :root tokens in app/globals.css).
 * Inline styles are allowed by the enforced CSP: `style-src 'self'
 * 'unsafe-inline'` is unconditional (lib/security-headers.ts) — verified
 * empirically in prod mode (pnpm build + pnpm start, T4 report).
 *
 * Copy: tuteo mexicano (project rule). No technical details; digest as a
 * short reference, same policy as app/error.tsx.
 */

'use client';

const styles = {
  body: {
    margin: 0,
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '1rem',
    backgroundColor: 'hsl(240 10% 4%)',
    color: 'hsl(0 0% 98%)',
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  },
  card: {
    width: '100%',
    maxWidth: '28rem',
    borderRadius: '0.5rem',
    border: '1px solid hsl(240 4% 16%)',
    backgroundColor: 'hsl(240 10% 6%)',
    padding: '1.5rem',
    textAlign: 'center' as const,
  },
  title: {
    margin: '0 0 0.5rem',
    fontSize: '1.25rem',
    fontWeight: 600,
    letterSpacing: '-0.025em',
  },
  description: {
    margin: '0 0 1.25rem',
    fontSize: '0.875rem',
    color: 'hsl(240 5% 65%)',
  },
  button: {
    display: 'inline-flex',
    height: '2.5rem',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '0.375rem',
    border: 'none',
    backgroundColor: 'hsl(142 71% 45%)',
    color: 'hsl(0 0% 100%)',
    padding: '0.5rem 1rem',
    fontSize: '0.875rem',
    fontWeight: 500,
    cursor: 'pointer',
  },
  digest: {
    margin: '0.75rem 0 0',
    fontSize: '0.75rem',
    color: 'hsl(240 5% 65%)',
  },
} as const;

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="es">
      <body style={styles.body}>
        <main style={styles.card}>
          <h1 style={styles.title}>Algo salió mal</h1>
          <p style={styles.description}>
            Ocurrió un error inesperado. Intenta de nuevo; si el problema
            persiste, recarga la página.
          </p>
          <button style={styles.button} onClick={reset}>
            Intentar de nuevo
          </button>
          {error.digest ? <p style={styles.digest}>Referencia: {error.digest}</p> : null}
        </main>
      </body>
    </html>
  );
}
