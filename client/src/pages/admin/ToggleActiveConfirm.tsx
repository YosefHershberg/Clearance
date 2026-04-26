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
import { useHttpClient } from '@/hooks/useHttpClient';
import { setActive } from '@/api/admin.api';
import { normalizeHttpError } from '@/lib/http-error';

type Props = { user: User | null; onOpenChange: (v: boolean) => void };

export function ToggleActiveConfirm({ user, onOpenChange }: Props) {
  const qc = useQueryClient();
  const { execute, isLoading } = useHttpClient({ fn: setActive });
  const next = user ? !user.isActive : true;

  const handleConfirm = async () => {
    if (!user) return;
    try {
      await execute(user.id, { isActive: next });
      toast.success(`${user.email} ${next ? 'enabled' : 'disabled'}`);
      await qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      await qc.invalidateQueries({ queryKey: ['admin', 'stats'] });
      onOpenChange(false);
    } catch (e) {
      toast.error(normalizeHttpError(e).message);
    }
  };

  return (
    <AlertDialog open={!!user} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {next ? 'Enable' : 'Disable'} {user?.email}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {next
              ? 'The user will be able to log in again.'
              : 'The user will be unable to log in until re-enabled.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={isLoading} onClick={handleConfirm}>
            {isLoading ? 'Saving…' : next ? 'Enable' : 'Disable'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
