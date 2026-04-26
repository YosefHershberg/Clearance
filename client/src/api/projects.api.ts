import { api } from '@/lib/axios';
import type { Project, ListProjectsResponse } from './types';

export async function listProjects(
  params: { q?: string; limit?: number; cursor?: string; all?: boolean } = {},
  signal?: AbortSignal,
): Promise<ListProjectsResponse> {
  const query: Record<string, string | number> = {};
  if (params.q) query.q = params.q;
  if (params.limit) query.limit = params.limit;
  if (params.cursor) query.cursor = params.cursor;
  if (params.all) query.all = 'true';
  const res = await api.get<{ data: ListProjectsResponse }>('/projects', { params: query, signal });
  return res.data.data;
}

export async function getProject(id: string, signal?: AbortSignal): Promise<Project> {
  const res = await api.get<{ data: { project: Project } }>(`/projects/${id}`, { signal });
  return res.data.data.project;
}

export async function createProject(
  body: { name: string; description?: string; locality?: string },
  signal?: AbortSignal,
): Promise<Project> {
  const res = await api.post<{ data: { project: Project } }>('/projects', body, { signal });
  return res.data.data.project;
}

export async function patchProject(
  id: string,
  body: { name?: string; description?: string | null; locality?: string | null },
  signal?: AbortSignal,
): Promise<Project> {
  const res = await api.patch<{ data: { project: Project } }>(`/projects/${id}`, body, { signal });
  return res.data.data.project;
}

export async function deleteProject(id: string, signal?: AbortSignal): Promise<void> {
  await api.delete(`/projects/${id}`, { signal });
}
