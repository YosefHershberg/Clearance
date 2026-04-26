import { Link } from 'react-router';
import { MapPin, CalendarDays, MoreVertical } from 'lucide-react';
import type { Project } from '@/api/types';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type Props = {
  project: Project;
  showOwner: boolean;
  onDelete: (p: Project) => void;
};

function formatDate(iso: string) {
  return new Intl.DateTimeFormat('he-IL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(iso));
}

export function ProjectCard({ project, showOwner, onDelete }: Props) {
  return (
    <div className="group relative flex flex-col gap-5 rounded-lg border border-border bg-card p-6 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-[0_6px_14px_rgba(30,41,59,0.06)]">
      <div className="flex items-start justify-between gap-3">
        <Link
          to={`/projects/${project.id}`}
          className="min-w-0 flex-1 text-lg font-bold text-foreground hover:text-primary"
        >
          <span className="block truncate">{project.name}</span>
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon-sm" className="-me-1 text-muted-foreground">
                <MoreVertical className="h-4 w-4" />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              className="text-destructive"
              onClick={() => onDelete(project)}
            >
              מחק פרויקט
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex flex-col gap-2 text-sm">
        {project.locality && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <MapPin className="h-4 w-4 shrink-0" />
            <span className="truncate">{project.locality}</span>
          </div>
        )}
        <div className="flex items-center gap-2 text-muted-foreground">
          <CalendarDays className="h-4 w-4 shrink-0" />
          <span>נוצר {formatDate(project.createdAt)}</span>
        </div>
      </div>

      {project.description && (
        <p className="line-clamp-2 text-sm text-muted-foreground">{project.description}</p>
      )}

      {showOwner && project.owner && (
        <div className="mt-auto flex items-center gap-2 border-t border-border/60 pt-3 text-xs text-muted-foreground">
          <span className="label-caps">בעלים</span>
          <span className="truncate text-foreground">{project.owner.email}</span>
        </div>
      )}
    </div>
  );
}
