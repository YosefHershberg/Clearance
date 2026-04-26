import { useState } from 'react';
import { Lock, Key, Power, Trash2 } from 'lucide-react';
import type { User } from '@/api/types';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import { ResetPasswordDialog } from './ResetPasswordDialog';
import { ToggleActiveConfirm } from './ToggleActiveConfirm';
import { DeleteUserConfirm } from './DeleteUserConfirm';

type Props = {
  users: User[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
};

function formatDate(iso: string) {
  return new Intl.DateTimeFormat('he-IL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(iso));
}

export function UsersTable({ users, isLoading, isError, onRetry }: Props) {
  const { user: me } = useAuth();
  const [resetTarget, setResetTarget] = useState<User | null>(null);
  const [toggleTarget, setToggleTarget] = useState<User | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);

  if (isError) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-destructive/40 bg-destructive/5 p-4">
        <span className="text-sm text-destructive">שגיאה בטעינת המשתמשים</span>
        <Button variant="outline" size="sm" onClick={onRetry}>
          נסה שוב
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow className="border-border">
              <TableHead className="label-caps py-4">אימייל</TableHead>
              <TableHead className="label-caps py-4">שם</TableHead>
              <TableHead className="label-caps py-4">תפקיד</TableHead>
              <TableHead className="label-caps py-4">פעיל</TableHead>
              <TableHead className="label-caps py-4">נוצר</TableHead>
              <TableHead className="label-caps py-4 text-center">פעולות</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                  טוען…
                </TableCell>
              </TableRow>
            )}
            {!isLoading && users.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                  אין משתמשים
                </TableCell>
              </TableRow>
            )}
            {!isLoading &&
              users.map((u) => {
                const isSelf = me?.id === u.id;
                const isAdmin = u.role === 'ADMIN';
                return (
                  <TableRow
                    key={u.id}
                    className={cn(
                      'border-border/60 transition-colors hover:bg-muted/40',
                      isAdmin && 'bg-muted/20',
                    )}
                  >
                    <TableCell className="py-4 font-medium text-foreground" dir="ltr">
                      {u.email}
                    </TableCell>
                    <TableCell className="py-4 text-foreground">{u.name}</TableCell>
                    <TableCell className="py-4">
                      {isAdmin ? (
                        <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-secondary">
                          <Lock className="h-3 w-3" />
                          ADMIN
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-md border border-border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          USER
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="py-4">
                      <div
                        className={cn(
                          'relative h-5 w-10 rounded-full transition-colors',
                          u.isActive ? 'bg-primary' : 'bg-muted',
                          isAdmin && 'opacity-60',
                        )}
                      >
                        <div
                          className={cn(
                            'absolute top-1 h-3 w-3 rounded-full bg-white shadow-sm transition-[inset-inline-end] duration-200',
                            u.isActive ? 'end-1' : 'end-6',
                          )}
                        />
                      </div>
                    </TableCell>
                    <TableCell className="py-4 text-sm text-muted-foreground">
                      {formatDate(u.createdAt)}
                    </TableCell>
                    <TableCell className="py-4">
                      {isAdmin || isSelf ? (
                        <div
                          className="flex items-center justify-center text-muted-foreground/60"
                          title="משתמש מערכת — לא ניתן לשנות"
                        >
                          <Lock className="h-4 w-4" />
                        </div>
                      ) : (
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-muted-foreground hover:text-foreground"
                            title="אפס סיסמה"
                            onClick={() => setResetTarget(u)}
                          >
                            <Key className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-muted-foreground hover:text-foreground"
                            title={u.isActive ? 'השבת' : 'הפעל'}
                            onClick={() => setToggleTarget(u)}
                          >
                            <Power className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-destructive/60 hover:text-destructive"
                            title="מחק"
                            onClick={() => setDeleteTarget(u)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
          </TableBody>
        </Table>
      </div>

      <ResetPasswordDialog user={resetTarget} onOpenChange={() => setResetTarget(null)} />
      <ToggleActiveConfirm user={toggleTarget} onOpenChange={() => setToggleTarget(null)} />
      <DeleteUserConfirm user={deleteTarget} onOpenChange={() => setDeleteTarget(null)} />
    </>
  );
}
