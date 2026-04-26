import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { User } from '@/api/types';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useHttpClient } from '@/hooks/useHttpClient';
import { deleteUser } from '@/api/admin.api';
import { normalizeHttpError } from '@/lib/http-error';

type Props = { user: User | null; onOpenChange: (v: boolean) => void };

export function DeleteUserConfirm({ user, onOpenChange }: Props) {
  const qc = useQueryClient();
  const [typed, setTyped] = useState('');
  const { execute, isLoading } = useHttpClient({ fn: deleteUser });

  const canDelete = !!user && typed === user.email;

  const handleConfirm = async () => {
    if (!user) return;
    try {
      await execute(user.id);
      toast.success(`Deleted ${user.email}`);
      await qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      await qc.invalidateQueries({ queryKey: ['admin', 'stats'] });
      setTyped('');
      onOpenChange(false);
    } catch (e) {
      toast.error(normalizeHttpError(e).message);
    }
  };

  return (
    <AlertDialog open={!!user} onOpenChange={(v) => { if (!v) setTyped(''); onOpenChange(v); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {user?.email}?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes the user. Type the user's email to confirm.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="confirm-email">Email</Label>
          <Input
            id="confirm-email"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={!canDelete || isLoading}
            onClick={handleConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isLoading ? 'Deleting…' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
