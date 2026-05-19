'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';

const COLLAPSE_STORAGE_KEY = 'ot:sidebar-collapsed';

export interface DashboardShellProps {
  userEmail: string;
  clientName: string;
  children: ReactNode;
}

export function DashboardShell({
  userEmail,
  clientName,
  children,
}: DashboardShellProps) {
  // Initial state is `false` so SSR + first client render agree. The persisted
  // value is hydrated in a useEffect after mount — at most a single re-layout
  // flash, no hydration mismatch. Brief explicitly accepts this trade-off.
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(COLLAPSE_STORAGE_KEY);
      if (stored === 'true') setIsCollapsed(true);
    } catch {
      // localStorage unavailable (private mode, SSR sneak-through, etc.) — ignore.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSE_STORAGE_KEY, String(isCollapsed));
    } catch {
      // ignore
    }
  }, [isCollapsed]);

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <Sidebar
        isCollapsed={isCollapsed}
        onToggleCollapse={() => setIsCollapsed((v) => !v)}
        isMobileOpen={isMobileOpen}
        onMobileClose={() => setIsMobileOpen(false)}
        userEmail={userEmail}
        clientName={clientName}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          userEmail={userEmail}
          clientName={clientName}
          onMobileToggle={() => setIsMobileOpen((v) => !v)}
        />
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
