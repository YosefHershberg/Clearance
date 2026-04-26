import { useRef, useEffect, useState, useCallback } from 'react';
import { AxiosError } from 'axios';

export function useHttpClient<TResponse, TArgs extends unknown[]>({
  fn: apiFn,
  onSuccess,
  onError,
}: {
  fn: (...args: [...TArgs, AbortSignal]) => Promise<TResponse>;
  onSuccess?: (data: TResponse) => void;
  onError?: (error: AxiosError) => void;
}) {
  const activeHttpRequests = useRef<AbortController[]>([]);
  const [state, setState] = useState<{
    data: TResponse | null;
    error: AxiosError | null;
    isLoading: boolean;
    responseStatus: number | null;
  }>({ data: null, error: null, isLoading: false, responseStatus: null });

  const execute = useCallback(
    async (...args: TArgs) => {
      const httpAbortCtrl = new AbortController();
      activeHttpRequests.current.push(httpAbortCtrl);
      setState((prev) => ({ ...prev, isLoading: true, error: null }));
      try {
        const res = await apiFn(...args, httpAbortCtrl.signal);
        setState((prev) => ({
          ...prev,
          data: res,
          responseStatus: (res as { status?: number } | null)?.status ?? null,
        }));
        onSuccess?.(res);
        return res;
      } catch (error) {
        setState((prev) => ({ ...prev, error: error as AxiosError }));
        onError?.(error as AxiosError);
        throw error;
      } finally {
        setState((prev) => ({ ...prev, isLoading: false }));
        activeHttpRequests.current = activeHttpRequests.current.filter(
          (reqCtrl) => reqCtrl !== httpAbortCtrl,
        );
      }
    },
    [apiFn, onSuccess, onError],
  );

  useEffect(() => {
    const requests = activeHttpRequests.current;
    return () => {
      requests.forEach((abortCtrl) => abortCtrl.abort());
      activeHttpRequests.current = [];
    };
  }, []);

  return {
    data: state.data,
    error: state.error,
    isLoading: state.isLoading,
    execute,
    responseStatus: state.responseStatus,
  };
}
