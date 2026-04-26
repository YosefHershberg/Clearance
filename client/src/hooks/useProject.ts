import { useQuery } from '@tanstack/react-query';
import { getProject } from '@/api/projects.api';

export function useProject(id: string | undefined) {
  return useQuery({
    queryKey: ['project', id],
    queryFn: ({ signal }) => getProject(id!, signal),
    enabled: !!id,
    staleTime: 0,
    retry: false,
  });
}
