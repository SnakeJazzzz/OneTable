'use client';

import type { Chain } from '@prisma/client';
import { useCredentials } from '@/lib/hooks/use-portales';
import { ChainCard } from './chain-card';

const ENABLED = ['SORIANA', 'CHEDRAUI', 'AMAZON'] as const;
const COMING_SOON = ['HEB', 'AL_SUPER', 'LA_COMER'] as const;

export function PortalesGrid() {
  // ONE credentials fetch for the whole page (FIX #2)
  const { credentials, loading: credLoading } = useCredentials();

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {ENABLED.map((c) => {
        const credRow = credentials.find((cr) => cr.chain === c);
        const initialUsername = credRow?.username ?? '';
        return (
          <ChainCard
            key={c}
            chain={c as Chain}
            initialUsername={initialUsername}
            credLoading={credLoading}
          />
        );
      })}
      {COMING_SOON.map((c) => (
        // FIX #6: global replace so AL_SUPER → AL SUPER (not just first underscore)
        <div key={c} className="rounded-lg border border-border bg-card/50 p-6 opacity-60">
          <h2 className="text-lg font-semibold">{c.replace(/_/g, ' ')}</h2>
          <p className="text-sm text-muted-foreground">
            Próximamente — llega cuando el cliente provea los archivos.
          </p>
        </div>
      ))}
    </div>
  );
}
