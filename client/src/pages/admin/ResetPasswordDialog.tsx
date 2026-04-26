import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { User } from '@/api/types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useHttpClient } from '@/hooks/useHttpClient';
import { resetPassword } from '@/api/admin.api';
import { normalizeHttpError } from '@/lib/http-error';

const schema = z.object({ newPassword: z.string().min(8, 'Min 8 characters') });
type Values = z.infer<typeof schema>;

type Props = { user: User | null; onOpenChange: (v: boolean) => void };

export function ResetPasswordDialog({ user, onOpenChange }: Props) {
  const qc = useQueryClient();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { newPassword: '' },
  });
  const { execute, isLoading } = useHttpClient({ fn: resetPassword });

  useEffect(() => {
    if (!user) form.reset();
  }, [user, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    if (!user) return;
    try {
      await execute(user.id, values);
      toast.success(`Password reset for ${user.email}`);
      await qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      form.reset();
      onOpenChange(false);
    } catch (e) {
      toast.error(normalizeHttpError(e).message);
    }
  });

  return (
    <Dialog open={!!user} onOpenChange={(v) => { if (!v) form.reset(); onOpenChange(v); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset password</DialogTitle>
          <DialogDescription>{user?.email}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reset-password">New password</Label>
            <Input
              id="reset-password"
              type="text"
              autoComplete="new-password"
              aria-invalid={!!form.formState.errors.newPassword}
              {...form.register('newPassword')}
            />
            {form.formState.errors.newPassword && (
              <p className="text-sm text-destructive">
                {form.formState.errors.newPassword.message}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Saving…' : 'Reset password'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
