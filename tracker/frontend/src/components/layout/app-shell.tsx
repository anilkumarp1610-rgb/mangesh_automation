import { FileText, LayoutDashboard, ListTree } from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { ThemeToggle } from '@/components/theme-toggle';
import { cn } from '@/lib/utils';

// AP Batches and Invoice Explorer are reached by drilling down from
// Interfaces, so they are not top-level nav items (routes still exist).
const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/interfaces', label: 'Interfaces', icon: ListTree },
  { to: '/tables', label: 'Data Tables', icon: FileText },
];

export function AppShell() {
  return (
    <div className="flex min-h-screen bg-muted/30">
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-background md:flex">
        <div className="flex h-14 items-center gap-2 border-b px-5 font-semibold">
          <div className="flex h-7 w-7 items-center justify-center rounded bg-primary text-primary-foreground">
            AP
          </div>
          Tracker
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-secondary text-secondary-foreground'
                    : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
                )
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t p-3 text-xs text-muted-foreground">v0.1.0 · airflow DB</div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b bg-background px-6">
          <div className="flex items-center gap-2 md:hidden font-semibold">AP Tracker</div>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
          </div>
        </header>
        <main className="min-w-0 flex-1 space-y-6 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
