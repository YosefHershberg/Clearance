import { useQuery } from '@tanstack/react-query';
import { listProjectDxfFiles } from '@/api/dxf.api';

export function useProjectDxfFiles(projectId: string | undefined) {
  return useQuery({
    queryKey: ['project-dxfs', projectId],
    queryFn: ({ signal }) => listProjectDxfFiles(projectId!, signal),
    enabled: !!projectId,
    staleTime: 0,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      const anyInFlight = data.dxfFiles.some(
        (d) => d.extractionStatus === 'PENDING' || d.extractionStatus === 'EXTRACTING',
      );
      return anyInFlight ? 2000 : false;
    },
  });
}
