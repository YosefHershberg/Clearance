import { useMemo, useState } from 'react';
import { Plus, Search, Folder } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useProjects } from '@/hooks/useProjects';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ProjectCard } from './projects/ProjectCard';
import { CreateProjectDialog } from './projects/CreateProjectDialog';
import { DeleteProjectConfirm } from './projects/DeleteProjectConfirm';
import type { Project } from '@/api/types';

export default function HomePage() {
  const { user } = useAuth();
  const [createOpen, setCreateOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [query, setQuery] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);

  const { data, isLoading, isError, refetch } = useProjects({ all: showAll });
  const projects = data?.projects ?? [];
  const isAdmin = user?.role === 'ADMIN';
  const showOwner = useMemo(() => isAdmin && showAll, [isAdmin, showAll]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.locality ?? '').toLowerCase().includes(q),
    );
  }, [projects, query]);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            {showAll ? 'כל הפרויקטים' : 'פרויקטים'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {projects.length} פרויקטים
            {isAdmin && (
              <>
                {' · '}
                <button
                  type="button"
                  onClick={() => setShowAll((v) => !v)}
                  className="text-primary hover:underline"
                >
                  {showAll ? 'הצג רק שלי' : 'הצג של כולם'}
                </button>
              </>
            )}
          </p>
        </div>
        <Button size="lg" className="gap-2" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          צור פרויקט חדש
        </Button>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute inset-y-0 end-4 my-auto h-5 w-5 text-primary" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="חפש פרויקט לפי שם..."
          className="h-12 bg-card pe-12 ps-4 text-base"
        />
      </div>

      {isError && (
        <div className="flex items-center justify-between rounded-md border border-destructive/40 bg-destructive/5 p-4">
          <span className="text-sm text-destructive">שגיאה בטעינת הפרויקטים</span>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            נסה שוב
          </Button>
        </div>
      )}

      {!isError && isLoading && (
        <p className="text-sm text-muted-foreground">טוען…</p>
      )}

      {!isError && !isLoading && projects.length === 0 && (
        <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-border/60 bg-card/40 p-16 text-center">
          <div className="grid h-14 w-14 place-items-center rounded-full bg-muted">
            <Folder className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-base text-muted-foreground">טרם יצרת פרויקט</p>
          <Button onClick={() => setCreateOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            צור פרויקט חדש
          </Button>
        </div>
      )}

      {!isError && !isLoading && projects.length > 0 && filtered.length === 0 && (
        <p className="text-sm text-muted-foreground">לא נמצאו פרויקטים תואמים לחיפוש</p>
      )}

      {!isError && !isLoading && filtered.length > 0 && (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              showOwner={showOwner}
              onDelete={setDeleteTarget}
            />
          ))}
        </div>
      )}

      <CreateProjectDialog open={createOpen} onOpenChange={setCreateOpen} />
      <DeleteProjectConfirm project={deleteTarget} onOpenChange={() => setDeleteTarget(null)} />
    </div>
  );
}
