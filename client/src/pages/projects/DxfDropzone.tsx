import { useRef, useState, type DragEvent, type ChangeEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useHttpClient } from '@/hooks/useHttpClient';
import { uploadDxf } from '@/api/dxf.api';
import { normalizeHttpError } from '@/lib/http-error';

const MAX_BYTES = 100 * 1024 * 1024;

type Props = { projectId: string };

export function DxfDropzone({ projectId }: Props) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const { execute, isLoading } = useHttpClient({ fn: uploadDxf });

  const handleFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.dxf')) {
      toast.error('רק קבצי DXF נתמכים');
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error('הקובץ חורג מהמגבלה של 100 מ"ב');
      return;
    }
    try {
      await execute({ projectId, file });
      toast.success(`${file.name} הועלה בהצלחה`);
      await qc.invalidateQueries({ queryKey: ['project-dxfs', projectId] });
    } catch (e) {
      toast.error(normalizeHttpError(e).message);
    }
  };

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    if (inputRef.current) inputRef.current.value = '';
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  return (
    <div
      onClick={() => !isLoading && inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      className={cn(
        'group flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 text-center transition-all',
        dragOver
          ? 'border-primary bg-primary/5'
          : 'border-border bg-card hover:border-primary/40 hover:bg-muted/40',
        isLoading && 'pointer-events-none opacity-60',
      )}
    >
      <div
        className={cn(
          'grid h-12 w-12 place-items-center rounded-full bg-muted transition-colors',
          'group-hover:bg-primary/10',
        )}
      >
        <FileText className="h-6 w-6 text-muted-foreground group-hover:text-primary" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-bold text-foreground">
          {isLoading ? 'מעלה…' : 'גרור קובץ DXF לכאן'}
        </p>
        <p className="text-xs text-muted-foreground">או לחץ לבחירת קובץ מהמחשב</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".dxf"
        className="hidden"
        onChange={onChange}
      />
    </div>
  );
}
