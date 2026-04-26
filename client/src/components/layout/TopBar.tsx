import { Link, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ModeToggle } from '@/components/mode-toggle';
import { useAuth } from '@/hooks/useAuth';
import { useHttpClient } from '@/hooks/useHttpClient';
import { logout as logoutApi } from '@/api/auth.api';
import { normalizeHttpError } from '@/lib/http-error';

function initials(name: string | undefined, email: string | undefined): string {
  const source = name?.trim() || email?.split('@')[0] || '?';
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function TopBar() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { execute, isLoading } = useHttpClient({ fn: logoutApi });

  const handleLogout = async () => {
    try {
      await execute();
    } catch (e) {
      toast.error(normalizeHttpError(e).message);
    } finally {
      qc.setQueryData(['me'], null);
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
      navigate('/login', { replace: true });
    }
  };

  if (!user) return null;

  return (
    <header className="sticky top-0 z-40 h-16 border-b bg-card">
      <div className="flex h-full items-center justify-between gap-6 px-8">
        <Link to="/" className="flex items-center gap-2">
          <span className="text-lg font-black tracking-tight text-primary">BuildCheck</span>
        </Link>

        <div className="relative hidden w-80 max-w-sm md:block">
          <Search className="pointer-events-none absolute inset-y-0 end-3 my-auto h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="חיפוש..."
            className="h-9 bg-muted/40 ps-4 pe-10 text-sm"
          />
        </div>

        <div className="flex items-center gap-2">
          <ModeToggle />
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="grid h-9 w-9 place-items-center rounded-full border border-border bg-muted/60 text-xs font-bold text-foreground hover:bg-muted"
                >
                  {initials(user.name, user.email)}
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuGroup>
                <DropdownMenuLabel className="text-xs text-muted-foreground">
                  {user.email}
                </DropdownMenuLabel>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout} disabled={isLoading}>
                התנתק
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
