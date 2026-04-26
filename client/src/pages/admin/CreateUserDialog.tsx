import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
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
import { createUser } from '@/api/admin.api';
import { normalizeHttpError } from '@/lib/http-error';

const schema = z.object({
  email: z.string().email(),
  name: z.string().min(1, 'Name is required').max(120),
  initialPassword: z.string().min(8, 'Min 8 characters'),
});
type Values = z.infer<typeof schema>;

type Props = { open: boolean; onOpenChange: (v: boolean) => void };

export function CreateUserDialog({ open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', name: '', initialPassword: '' },
  });
  const { execute, isLoading } = useHttpClient({ fn: createUser });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await execute(values);
      toast.success(`User ${values.email} created`);
      await qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      await qc.invalidateQueries({ queryKey: ['admin', 'stats'] });
      form.reset();
      onOpenChange(false);
    } catch (e) {
      toast.error(normalizeHttpError(e).message);
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) form.reset();
        onOpenChange(v);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create user</DialogTitle>
          <DialogDescription>
            You set the initial password. Share it with the new user out-of-band; they can change it after signing in.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="create-email">Email</Label>
            <Input
              id="create-email"
              type="email"
              aria-invalid={!!form.formState.errors.email}
              {...form.register('email')}
            />
            {form.formState.errors.email && (
              <p className="text-sm text-destructive">{form.formState.errors.email.message}</p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="create-name">Name</Label>
            <Input
              id="create-name"
              aria-invalid={!!form.formState.errors.name}
              {...form.register('name')}
            />
            {form.formState.errors.name && (
              <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="create-password">Initial password</Label>
            <Input
              id="create-password"
              type="text"
              autoComplete="new-password"
              aria-invalid={!!form.formState.errors.initialPassword}
              {...form.register('initialPassword')}
            />
            {form.formState.errors.initialPassword && (
              <p className="text-sm text-destructive">
                {form.formState.errors.initialPassword.message}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Creating…' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
