import { useMemo } from 'react';
import { X, ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { ClassificationBadge } from '@/components/ui/classification-badge';
import type { SheetClassification, SheetRender } from '@/api/types';

interface Props {
  dxfFileId: string;
  sheet: SheetRender | null;
  sheets?: SheetRender[];
  onClose: () => void;
  onSelect?: (sheet: SheetRender) => void;
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

export function DxfPreviewLightbox({ dxfFileId, sheet, sheets, onClose, onSelect }: Props) {
  const open = sheet !== null;
  const activeIndex = useMemo(() => {
    if (!sheet || !sheets) return -1;
    return sheets.findIndex((s) => s.id === sheet.id);
  }, [sheet, sheets]);
  const canPrev = sheets !== undefined && activeIndex > 0;
  const canNext = sheets !== undefined && activeIndex >= 0 && activeIndex < sheets.length - 1;

  const goPrev = () => {
    if (canPrev && sheets && onSelect) onSelect(sheets[activeIndex - 1]);
  };
  const goNext = () => {
    if (canNext && sheets && onSelect) onSelect(sheets[activeIndex + 1]);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        className="h-screen max-h-none w-screen max-w-none rounded-none border-0 bg-[rgba(30,41,59,0.92)] p-0 text-white backdrop-blur-sm sm:rounded-none"
        showCloseButton={false}
      >
        {sheet && (
          <div className="flex h-full w-full flex-col">
            <div className="flex items-center justify-between px-6 py-4">
              <button
                type="button"
                onClick={onClose}
                className="grid h-10 w-10 place-items-center rounded-full border border-white/20 text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                aria-label="סגור"
              >
                <X className="h-5 w-5" />
              </button>
              <DialogTitle className="sr-only">{sheet.displayName}</DialogTitle>
            </div>

            <div className="relative flex flex-1 items-center justify-center px-6 pb-6">
              {sheets && onSelect && (
                <>
                  <button
                    type="button"
                    onClick={goPrev}
                    disabled={!canPrev}
                    className="absolute end-8 z-10 grid h-14 w-14 place-items-center rounded-full border border-white/10 bg-slate-800/40 text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-30"
                    aria-label="דף קודם"
                  >
                    <ChevronRight className="h-7 w-7" />
                  </button>
                  <button
                    type="button"
                    onClick={goNext}
                    disabled={!canNext}
                    className="absolute start-8 z-10 grid h-14 w-14 place-items-center rounded-full border border-white/10 bg-slate-800/40 text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-30"
                    aria-label="דף הבא"
                  >
                    <ChevronLeft className="h-7 w-7" />
                  </button>
                </>
              )}
              <div className="relative mx-auto max-h-full max-w-6xl overflow-hidden rounded-sm border border-slate-700 bg-white shadow-2xl">
                <img
                  src={`/api/renders/${dxfFileId}/${sheet.filename}`}
                  alt={sheet.displayName}
                  className="max-h-[72vh] w-auto object-contain p-6"
                />
              </div>
            </div>

            <div className="flex flex-col items-center gap-2 bg-gradient-to-t from-slate-950/80 to-transparent px-6 py-6">
              <ClassificationBadge className="border-white/40 text-white">
                {CLASSIFICATION_LABELS[sheet.classification]}
              </ClassificationBadge>
              <h2 className="text-xl font-bold tracking-tight text-white" dir="rtl">
                {sheet.displayName}
              </h2>
              {sheets && activeIndex >= 0 && (
                <div className="text-sm font-medium tracking-widest text-slate-400">
                  {activeIndex + 1} / {sheets.length}
                </div>
              )}
              {sheet.svgWarning && (
                <div className="mt-2 flex items-center gap-2 text-xs text-amber-300">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  <span>{sheet.svgWarning}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
