import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
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
import { createProject } from '@/api/projects.api';
import { normalizeHttpError } from '@/lib/http-error';

const schema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  description: z.string().trim().max(2000).optional(),
  locality: z.string().trim().max(120).optional(),
});
type Values = z.infer<typeof schema>;

type Props = { open: boolean; onOpenChange: (v: boolean) => void };

export function CreateProjectDialog({ open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', description: '', locality: '' },
  });
  const { execute, isLoading } = useHttpClient({ fn: createProject });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const project = await execute({
        name: values.name,
        description: values.description || undefined,
        locality: values.locality || undefined,
      });
      toast.success(`Project "${project.name}" created`);
      await qc.invalidateQueries({ queryKey: ['projects'] });
      form.reset();
      onOpenChange(false);
      navigate(`/projects/${project.id}`);
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
          <DialogTitle>Create project</DialogTitle>
          <DialogDescription>Name is required. Description and locality are optional.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="create-proj-name">Name</Label>
            <Input
              id="create-proj-name"
              aria-invalid={!!form.formState.errors.name}
              {...form.register('name')}
            />
            {form.formState.errors.name && (
              <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="create-proj-description">Description</Label>
            <Input id="create-proj-description" {...form.register('description')} />
            {form.formState.errors.description && (
              <p className="text-sm text-destructive">{form.formState.errors.description.message}</p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="create-proj-locality">Locality</Label>
            <Input id="create-proj-locality" {...form.register('locality')} />
            {form.formState.errors.locality && (
              <p className="text-sm text-destructive">{form.formState.errors.locality.message}</p>
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
