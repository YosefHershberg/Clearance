import { AlertTriangle, Eye } from 'lucide-react';
import { ClassificationBadge } from '@/components/ui/classification-badge';
import type { SheetClassification, SheetRender } from '@/api/types';

interface Props {
  dxfFileId: string;
  sheets: SheetRender[];
  onSelect: (sheet: SheetRender) => void;
}

const CLASSIFICATION_LABELS: Record<SheetClassification, string> = {
  FLOOR_PLAN: 'תכנית קומה',
  ELEVATION: 'חזית',
  CROSS_SECTION: 'חתך',
  PARKING_SECTION: 'חנייה',
  SURVEY: 'מדידה',
  SITE_PLAN: 'תכנית מגרש',
  ROOF_PLAN: 'תכנית גג',
  AREA_CALCULATION: 'חישוב שטחים',
  INDEX_PAGE: 'תוכן',
  UNCLASSIFIED: 'לא מסווג',
};

export function DxfPreviewGrid({ dxfFileId, sheets, onSelect }: Props) {
  if (sheets.length === 0) {
    return <p className="text-sm text-muted-foreground">אין גיליונות להצגה</p>;
  }
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {sheets.map((sheet, idx) => (
        <button
          key={sheet.id}
          type="button"
          onClick={() => onSelect(sheet)}
          className="group flex flex-col overflow-hidden rounded-lg border border-border bg-card text-start transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-[0_6px_14px_rgba(30,41,59,0.06)] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <div className="relative aspect-video w-full overflow-hidden bg-muted/40">
            <img
              src={`/api/renders/${dxfFileId}/${sheet.filename}`}
              alt={sheet.displayName}
              className="h-full w-full object-contain transition-transform group-hover:scale-[1.02]"
              loading="lazy"
            />
            <div className="absolute end-2 top-2">
              <ClassificationBadge>
                {CLASSIFICATION_LABELS[sheet.classification]}
              </ClassificationBadge>
            </div>
            {sheet.svgWarning && (
              <div
                className="absolute start-2 top-2 rounded-full bg-[color:var(--warning)]/15 p-1 text-[color:var(--warning)]"
                title={sheet.svgWarning}
              >
                <AlertTriangle className="h-3.5 w-3.5" />
              </div>
            )}
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-border/60 px-4 py-3">
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-bold text-foreground" dir="rtl">
                {sheet.displayName}
              </span>
              <span className="text-xs text-muted-foreground">
                דף {idx + 1} מתוך {sheets.length}
              </span>
            </div>
            <Eye className="h-4 w-4 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-primary" />
          </div>
        </button>
      ))}
    </div>
  );
}
