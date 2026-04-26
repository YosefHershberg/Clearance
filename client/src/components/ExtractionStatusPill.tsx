import { StatusPill } from '@/components/ui/status-pill';
import type { ExtractionStatus } from '@/api/types';

type Props = { status: ExtractionStatus };

const LABELS: Record<ExtractionStatus, string> = {
  PENDING: 'ממתין',
  EXTRACTING: 'בעיבוד',
  COMPLETED: 'הושלם',
  FAILED: 'נכשל',
};

export function ExtractionStatusPill({ status }: Props) {
  switch (status) {
    case 'PENDING':
      return <StatusPill variant="idle">{LABELS.PENDING}</StatusPill>;
    case 'EXTRACTING':
      return (
        <StatusPill variant="processing" className="gap-1.5">
          <span className="size-1.5 animate-pulse rounded-full bg-primary" />
          {LABELS.EXTRACTING}
        </StatusPill>
      );
    case 'COMPLETED':
      return <StatusPill variant="completed">{LABELS.COMPLETED}</StatusPill>;
    case 'FAILED':
      return <StatusPill variant="failed">{LABELS.FAILED}</StatusPill>;
  }
}
