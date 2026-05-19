'use client';

import { useEffect, useRef, useState } from 'react';
import { signOut } from 'next-auth/react';
import { LogOut, Menu } from 'lucide-react';

const MENU_TRIGGER_ID = 'topbar-user-menu-trigger';

export interface TopbarProps {
  userEmail: string;
  clientName: string;
  onMobileToggle: () => void;
}

export function Topbar({ userEmail, clientName, onMobileToggle }: TopbarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const firstLetter = userEmail.charAt(0).toUpperCase();

  // Close the dropdown when clicking outside or pressing Escape.
  useEffect(() => {
    if (!isOpen) return;
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [isOpen]);

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-border bg-background px-4">
      <button
        type="button"
        onClick={onMobileToggle}
        className="md:hidden inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        aria-label="Abrir menú"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Spacer to keep avatar right-aligned on mobile */}
      <div className="md:hidden flex-1" aria-hidden="true" />

      {/* Desktop: avatar on the right; the parent justify-between handles spacing */}
      <div className="hidden md:block" aria-hidden="true" />

      <div ref={containerRef} className="relative">
        <button
          type="button"
          id={MENU_TRIGGER_ID}
          onClick={() => setIsOpen((v) => !v)}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-colors"
          aria-label="Menú de usuario"
          aria-haspopup="menu"
          aria-expanded={isOpen}
        >
          {firstLetter}
        </button>

        {isOpen && (
          <div
            role="menu"
            aria-labelledby={MENU_TRIGGER_ID}
            className="absolute right-0 top-full mt-2 w-64 origin-top-right rounded-md border border-border bg-popover text-popover-foreground shadow-lg"
          >
            <div className="border-b border-border px-3 py-3">
              <p className="truncate text-sm font-medium" title={userEmail}>
                {userEmail}
              </p>
              <p className="truncate text-xs text-muted-foreground" title={clientName}>
                {clientName}
              </p>
            </div>
            <button
              type="button"
              role="menuitem"
              onClick={() => signOut({ callbackUrl: '/login' })}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              <LogOut className="h-4 w-4 shrink-0" />
              <span>Cerrar sesión</span>
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
