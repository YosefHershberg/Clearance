import { useMemo, type ReactNode } from 'react';
import { useMe } from '@/hooks/useMe';
import { AuthContext, type AuthContextValue } from './auth-context';

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data, isLoading } = useMe();
  const value = useMemo<AuthContextValue>(
    () => ({ user: data ?? null, isLoading, isAuthenticated: !!data }),
    [data, isLoading],
  );

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="size-8 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
      </div>
    );
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
