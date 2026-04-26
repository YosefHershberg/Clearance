import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { listUsers, getStats } from '@/api/admin.api';
import { Button } from '@/components/ui/button';
import { UsersTable } from './UsersTable';
import { CreateUserDialog } from './CreateUserDialog';

export default function AdminUsersPage() {
  const [createOpen, setCreateOpen] = useState(false);

  const usersQ = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: ({ signal }) => listUsers({ limit: 50 }, signal),
    staleTime: 0,
  });

  const statsQ = useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: ({ signal }) => getStats(signal),
    staleTime: 30_000,
  });

  const userCount = statsQ.data?.userCount ?? usersQ.data?.users.length ?? 0;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            ניהול משתמשים
          </h1>
          <p className="text-sm text-muted-foreground">
            {userCount} משתמשים במערכת
          </p>
        </div>
        <Button size="lg" className="gap-2" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          צור משתמש
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-5">
          <p className="label-caps">משתמשים</p>
          <p className="mt-2 text-3xl font-bold tracking-tight text-foreground">
            {statsQ.isLoading ? '—' : statsQ.data?.userCount ?? 0}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-5">
          <p className="label-caps">פרויקטים</p>
          <p className="mt-2 text-3xl font-bold tracking-tight text-foreground">
            {statsQ.isLoading ? '—' : statsQ.data?.projectCount ?? 0}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-5">
          <p className="label-caps">ניתוחים</p>
          <p className="mt-2 text-3xl font-bold tracking-tight text-foreground">
            {statsQ.isLoading ? '—' : statsQ.data?.analysisCount ?? 0}
          </p>
        </div>
      </div>

      <UsersTable
        users={usersQ.data?.users ?? []}
        isLoading={usersQ.isLoading}
        isError={usersQ.isError}
        onRetry={() => usersQ.refetch()}
      />

      <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
