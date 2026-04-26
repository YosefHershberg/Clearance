import { api } from '@/lib/axios';
import type { AdminStats, ListUsersResponse, User } from './types';

export async function listUsers(
  params: { q?: string; limit?: number; cursor?: string } = {},
  signal?: AbortSignal,
): Promise<ListUsersResponse> {
  const res = await api.get<{ data: ListUsersResponse }>('/admin/users', { params, signal });
  return res.data.data;
}

export async function createUser(
  body: { email: string; name: string; initialPassword: string },
  signal?: AbortSignal,
): Promise<User> {
  const res = await api.post<{ data: { user: User } }>('/admin/users', body, { signal });
  return res.data.data.user;
}

export async function deleteUser(id: string, signal?: AbortSignal): Promise<void> {
  await api.delete(`/admin/users/${id}`, { signal });
}

export async function resetPassword(
  id: string,
  body: { newPassword: string },
  signal?: AbortSignal,
): Promise<void> {
  await api.post(`/admin/users/${id}/reset-password`, body, { signal });
}

export async function setActive(
  id: string,
  body: { isActive: boolean },
  signal?: AbortSignal,
): Promise<User> {
  const res = await api.patch<{ data: { user: User } }>(`/admin/users/${id}/active`, body, { signal });
  return res.data.data.user;
}

export async function getStats(signal?: AbortSignal): Promise<AdminStats> {
  const res = await api.get<{ data: AdminStats }>('/admin/stats', { signal });
  return res.data.data;
}
