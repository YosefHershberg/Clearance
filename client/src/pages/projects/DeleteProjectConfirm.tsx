import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router';
import { toast } from 'sonner';
import type { Project } from '@/api/types';
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
import { deleteProject } from '@/api/projects.api';
import { normalizeHttpError } from '@/lib/http-error';

type Props = { project: Project | null; onOpenChange: (v: boolean) => void };

export function DeleteProjectConfirm({ project, onOpenChange }: Props) {
  const qc = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const [typed, setTyped] = useState('');
  const { execute, isLoading } = useHttpClient({ fn: deleteProject });

  const canDelete = !!project && typed === project.name;

  const handleConfirm = async () => {
    if (!project) return;
    try {
      await execute(project.id);
      toast.success(`Deleted "${project.name}"`);
      await qc.invalidateQueries({ queryKey: ['projects'] });
      await qc.invalidateQueries({ queryKey: ['project', project.id] });
      setTyped('');
      onOpenChange(false);
      if (location.pathname.startsWith(`/projects/${project.id}`)) {
        navigate('/', { replace: true });
      }
    } catch (e) {
      toast.error(normalizeHttpError(e).message);
    }
  };

  return (
    <AlertDialog
      open={!!project}
      onOpenChange={(v) => {
        if (!v) setTyped('');
        onOpenChange(v);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete "{project?.name}"?</AlertDialogTitle>
          <AlertDialogDescription>
            This soft-deletes the project; it will stop appearing in lists. Type the project's name to confirm.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="confirm-project-name">Name</Label>
          <Input
            id="confirm-project-name"
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
