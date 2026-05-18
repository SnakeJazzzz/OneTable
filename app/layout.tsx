import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'OneTable', description: 'Portal de portales para retail' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className="dark">
      <body>{children}</body>
    </html>
  );
}
