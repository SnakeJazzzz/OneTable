import { PortalesGrid } from '@/components/portales/portales-grid';

// FIX #2: thin server shell — client grid owns the data fetching
export default function PortalesPage() {
  return (
    <div className="p-8 space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">Portales</h1>
        <p className="text-muted-foreground">
          Configurá cada cadena: usuario, carga de archivos y mapeo de productos.
        </p>
      </header>
      <PortalesGrid />
    </div>
  );
}
