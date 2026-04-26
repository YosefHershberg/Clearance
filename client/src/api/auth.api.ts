import { api } from '@/lib/axios';
import type { User } from './types';

export async function login(body: { email: string; password: string }, signal?: AbortSignal) {
  const res = await api.post<{ data: { user: User } }>('/auth/login', body, { signal });
  return res.data.data.user;
}

export async function logout(signal?: AbortSignal) {
  await api.post<{ data: { ok: true } }>('/auth/logout', undefined, { signal });
}

export async function getMe(signal?: AbortSignal): Promise<User | null> {
  try {
    const res = await api.get<{ data: { user: User } }>('/auth/me', { signal });
    return res.data.data.user;
  } catch (err: unknown) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 401) return null;
    throw err;
  }
}
