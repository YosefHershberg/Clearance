import { useQuery } from '@tanstack/react-query';
import { getDxfFile } from '@/api/dxf.api';

export function useDxfFile(id: string | undefined) {
  return useQuery({
    queryKey: ['dxf', id],
    queryFn: ({ signal }) => getDxfFile(id!, signal),
    enabled: !!id,
    staleTime: 0,
    refetchInterval: (query) => {
      const status = query.state.data?.extractionStatus;
      return status === 'PENDING' || status === 'EXTRACTING' ? 2000 : false;
    },
  });
}
