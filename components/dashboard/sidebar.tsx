'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  SlidersHorizontal,
  Store,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type NavItem = { href: string; label: string; icon: LucideIcon };

const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/analisis', label: 'Análisis', icon: BarChart3 },
  { href: '/portales', label: 'Portales', icon: Store },
  { href: '/parametros', label: 'Parámetros', icon: SlidersHorizontal },
  { href: '/promotoria', label: 'Promotoría', icon: ClipboardList },
];

export interface SidebarProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  isMobileOpen: boolean;
  onMobileClose: () => void;
  userEmail: string;
  clientName: string;
}

export function Sidebar({
  isCollapsed,
  onToggleCollapse,
  isMobileOpen,
  onMobileClose,
  userEmail,
  clientName,
}: SidebarProps) {
  const pathname = usePathname();
  const firstLetter = userEmail.charAt(0).toUpperCase();

  return (
    <>
      {/* Mobile backdrop — clicks close the drawer */}
      {isMobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-30 bg-black/60"
          onClick={onMobileClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          'fixed md:sticky top-0 z-40 flex h-screen flex-col border-r border-border bg-card transition-all duration-200',
          // Desktop width controlled by isCollapsed
          isCollapsed ? 'md:w-16' : 'md:w-60',
          // Mobile: always expanded width, slides in/out via translate
          'w-60',
          isMobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
        )}
        aria-label="Sidebar principal"
      >
        {/* Logo header */}
        <div className="flex h-16 items-center justify-center border-b border-border px-4">
          <Link
            href="/dashboard"
            className="text-primary font-bold transition-all duration-200"
            aria-label="OneTable inicio"
          >
            {isCollapsed ? (
              <span className="text-2xl">1T</span>
            ) : (
              <span className="text-xl">OneTable</span>
            )}
          </Link>
        </div>

        {/* Nav items */}
        <nav
          aria-label="Navegación principal"
          className="flex-1 overflow-y-auto px-2 py-4"
        >
          <ul className="space-y-1">
            {NAV_ITEMS.map((item) => {
              const isActive =
                pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onMobileClose}
                    title={isCollapsed ? item.label : undefined}
                    className={cn(
                      'flex items-center gap-3 rounded-md border-l-2 px-3 py-2 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-accent text-foreground border-primary'
                        : 'border-transparent text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                      isCollapsed && 'justify-center px-2',
                    )}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {!isCollapsed && <span className="truncate">{item.label}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Footer: user info + logout */}
        <div className="border-t border-border p-3">
          {isCollapsed ? (
            <div className="flex flex-col items-center gap-2">
              <div
                className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-semibold"
                title={`${userEmail} — ${clientName}`}
                aria-label={`Usuario ${userEmail}`}
              >
                {firstLetter}
              </div>
              <button
                type="button"
                onClick={() => signOut({ callbackUrl: '/login' })}
                title="Cerrar sesión"
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                aria-label="Cerrar sesión"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="px-1 text-xs">
                <p className="truncate font-medium text-foreground" title={userEmail}>
                  {userEmail}
                </p>
                <p className="truncate text-muted-foreground" title={clientName}>
                  {clientName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => signOut({ callbackUrl: '/login' })}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                <LogOut className="h-4 w-4 shrink-0" />
                <span>Cerrar sesión</span>
              </button>
            </div>
          )}
        </div>

        {/* Desktop-only toggle button, sitting on the right border */}
        <button
          type="button"
          onClick={onToggleCollapse}
          className="hidden md:flex absolute -right-3 top-1/2 -translate-y-1/2 h-6 w-6 items-center justify-center rounded-full border border-border bg-background text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shadow-sm"
          aria-label={isCollapsed ? 'Expandir sidebar' : 'Colapsar sidebar'}
        >
          {isCollapsed ? (
            <ChevronRight className="h-3 w-3" />
          ) : (
            <ChevronLeft className="h-3 w-3" />
          )}
        </button>
      </aside>
    </>
  );
}
