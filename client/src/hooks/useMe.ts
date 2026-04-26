import { useQuery } from '@tanstack/react-query';
import { getMe } from '@/api/auth.api';

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: ({ signal }) => getMe(signal),
    staleTime: 5 * 60_000,
    retry: false,
  });
}
