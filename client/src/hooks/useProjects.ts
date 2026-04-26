import { useQuery } from '@tanstack/react-query';
import { listProjects } from '@/api/projects.api';

export function useProjects(opts: { all?: boolean; q?: string } = {}) {
  return useQuery({
    queryKey: ['projects', { all: !!opts.all, q: opts.q ?? '' }],
    queryFn: ({ signal }) => listProjects({ all: opts.all, q: opts.q, limit: 50 }, signal),
    staleTime: 0,
  });
}
