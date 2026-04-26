import { NavLink } from 'react-router';
import { FolderOpen, ClipboardCheck, Users, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';

type Item = {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  end?: boolean;
  disabled?: boolean;
};

export function Sidebar() {
  const { user } = useAuth();
  const items: Item[] = [
    { to: '/', icon: FolderOpen, label: 'פרויקטים', end: true },
    { to: '#compliance', icon: ClipboardCheck, label: 'תאימות', disabled: true },
    ...(user?.role === 'ADMIN'
      ? [{ to: '/admin/users', icon: Users, label: 'ניהול משתמשים' }]
      : []),
    { to: '#settings', icon: Settings, label: 'הגדרות', disabled: true },
  ];

  return (
    <aside className="hidden w-64 shrink-0 border-e bg-muted/40 lg:flex lg:flex-col">
      <div className="flex h-16 items-center gap-3 border-b border-border/60 px-6">
        <div className="grid h-9 w-9 place-items-center rounded-md bg-primary text-primary-foreground">
          <span className="text-sm font-black">BC</span>
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-base font-bold text-foreground">BuildCheck</span>
          <span className="text-xs text-muted-foreground">מערכת תאימות</span>
        </div>
      </div>
      <nav className="flex flex-1 flex-col gap-1 p-4">
        {items.map((item) => {
          const Icon = item.icon;
          if (item.disabled) {
            return (
              <div
                key={item.label}
                className="flex cursor-not-allowed items-center gap-3 rounded-md px-4 py-2.5 text-sm text-muted-foreground/60"
              >
                <Icon className="h-4 w-4" />
                <span>{item.label}</span>
              </div>
            );
          }
          return (
            <NavLink
              key={item.label}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'group flex items-center gap-3 rounded-md px-4 py-2.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'border-s-4 border-primary bg-background text-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className={cn('h-4 w-4', isActive && 'text-primary')} />
                  <span>{item.label}</span>
                </>
              )}
            </NavLink>
          );
        })}
      </nav>
    </aside>
  );
}
