import type { AxiosError } from 'axios';

export type NormalizedHttpError = {
  status: number | null;
  message: string;
  details?: Array<{ message: string }>;
};

export function normalizeHttpError(err: unknown): NormalizedHttpError {
  const ax = err as AxiosError<{ error?: string; details?: Array<{ message: string }> }>;
  const status = ax?.response?.status ?? null;
  const payload = ax?.response?.data;
  const message = payload?.error ?? ax?.message ?? 'Unexpected error';
  return { status, message, details: payload?.details };
}
