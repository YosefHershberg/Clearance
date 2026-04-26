import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { ChevronLeft, Trash2 } from 'lucide-react';
import { useProject } from '@/hooks/useProject';
import { useProjectDxfFiles } from '@/hooks/useProjectDxfFiles';
import { useDxfFile } from '@/hooks/useDxfFile';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { DeleteProjectConfirm } from './projects/DeleteProjectConfirm';
import { DxfDropzone } from './projects/DxfDropzone';
import { ExtractionStatusPill } from '@/components/ExtractionStatusPill';
import { DxfPreviewGrid } from '@/components/DxfPreviewGrid';
import { DxfPreviewLightbox } from '@/components/DxfPreviewLightbox';
import type { Project, SheetRender } from '@/api/types';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('he-IL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(iso));
}

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data, isLoading, isError, error } = useProject(id);
  const dxfsQuery = useProjectDxfFiles(id);
  const dxfFilesList = dxfsQuery.data?.dxfFiles ?? [];
  const currentDxfForDetail = dxfFilesList[0];
  const dxfDetail = useDxfFile(
    currentDxfForDetail?.extractionStatus === 'COMPLETED'
      ? currentDxfForDetail.id
      : undefined,
  );
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [lightboxSheet, setLightboxSheet] = useState<SheetRender | null>(null);

  useEffect(() => {
    if (isError) {
      const status = (error as { response?: { status?: number } })?.response?.status;
      if (status === 404 || status === 403) {
        toast.error('הפרויקט לא נמצא');
        navigate('/', { replace: true });
      }
    }
  }, [isError, error, navigate]);

  if (isLoading) return <p className="text-sm text-muted-foreground">טוען…</p>;
  if (!data) return null;

  const project = data;
  const isOwnerOrAdmin = user?.id === project.ownerId || user?.role === 'ADMIN';
  const dxfFiles = dxfFilesList;
  const currentDxf = currentDxfForDetail;
  const sheetRenders = dxfDetail.data?.sheetRenders ?? [];

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">פרויקטים</Link>
        <ChevronLeft className="h-3.5 w-3.5" />
        <span className="text-foreground">{project.name}</span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            {project.name}
          </h1>
          {project.locality && (
            <p className="text-sm text-muted-foreground">{project.locality}</p>
          )}
        </div>
        {isOwnerOrAdmin && (
          <Button
            variant="outline"
            className="gap-2 border-destructive/30 text-destructive hover:bg-destructive/5"
            onClick={() => setDeleteTarget(project)}
          >
            <Trash2 className="h-4 w-4" />
            מחק פרויקט
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-10">
        <aside className="flex flex-col gap-4 lg:col-span-3">
          <section className="rounded-lg border border-border bg-card p-6">
            <h2 className="mb-5 text-sm font-bold text-foreground">פרטי פרויקט</h2>
            <dl className="flex flex-col gap-4 text-sm">
              <div className="flex flex-col gap-1">
                <dt className="label-caps">תאריך יצירה</dt>
                <dd className="font-medium text-foreground">{formatDate(project.createdAt)}</dd>
              </div>
              {project.locality && (
                <div className="flex flex-col gap-1">
                  <dt className="label-caps">כתובת</dt>
                  <dd className="font-medium text-foreground">{project.locality}</dd>
                </div>
              )}
              {project.owner && (
                <div className="flex flex-col gap-1">
                  <dt className="label-caps">בעלים</dt>
                  <dd className="font-medium text-foreground">{project.owner.email}</dd>
                </div>
              )}
              {project.description && (
                <div className="flex flex-col gap-1">
                  <dt className="label-caps">תיאור</dt>
                  <dd className="whitespace-pre-wrap text-foreground">{project.description}</dd>
                </div>
              )}
            </dl>
          </section>

          {isOwnerOrAdmin && <DxfDropzone projectId={project.id} />}

          {dxfFiles.length > 0 && (
            <section className="rounded-lg border border-border bg-card p-5">
              <h2 className="mb-4 text-sm font-bold text-foreground">קבצי DXF</h2>
              <ul className="flex flex-col gap-3">
                {dxfFiles.map((dxf) => (
                  <li key={dxf.id} className="flex flex-col gap-2 rounded-md border border-border/60 bg-background p-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-sm font-medium text-foreground" dir="ltr">
                        {dxf.originalName}
                      </span>
                      <ExtractionStatusPill status={dxf.extractionStatus} />
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{formatSize(dxf.sizeBytes)}</span>
                      <span aria-hidden>·</span>
                      <span dir="ltr">{dxf.sha256.slice(0, 12)}…</span>
                      <span aria-hidden>·</span>
                      <span>{formatDate(dxf.createdAt)}</span>
                    </div>
                    {dxf.extractionError && (
                      <p className="text-xs text-destructive">{dxf.extractionError}</p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>

        <section className="lg:col-span-7">
          {dxfsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">טוען…</p>
          ) : dxfFiles.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border/60 bg-card/40 p-16 text-center">
              <p className="text-base text-muted-foreground">טרם הועלה קובץ DXF לפרויקט זה</p>
              {isOwnerOrAdmin && (
                <p className="text-xs text-muted-foreground">העלה קובץ כדי להפעיל ניתוח תאימות</p>
              )}
            </div>
          ) : (
            <>
              <div className="mb-4 flex items-baseline justify-between">
                <h2 className="text-xl font-bold text-foreground">דפי התכנית</h2>
                {sheetRenders.length > 0 && (
                  <span className="text-sm text-muted-foreground">{sheetRenders.length} דפים</span>
                )}
              </div>
              {currentDxf && sheetRenders.length > 0 ? (
                <DxfPreviewGrid
                  dxfFileId={currentDxf.id}
                  sheets={sheetRenders}
                  onSelect={setLightboxSheet}
                />
              ) : (
                <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border/60 bg-card/40 p-16 text-center">
                  <p className="text-base text-muted-foreground">
                    {currentDxf?.extractionStatus === 'FAILED'
                      ? 'החילוץ נכשל — בדוק את השגיאה בפאנל קבצי ה-DXF'
                      : 'ממתין לסיום עיבוד הדפים…'}
                  </p>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      <DxfPreviewLightbox
        dxfFileId={currentDxf?.id ?? ''}
        sheet={lightboxSheet}
        onClose={() => setLightboxSheet(null)}
      />

      <DeleteProjectConfirm project={deleteTarget} onOpenChange={() => setDeleteTarget(null)} />
    </div>
  );
}
