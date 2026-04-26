import { api } from '@/lib/axios';
import type { DxfFile, ListDxfFilesResponse } from './types';

export async function uploadDxf(
  args: { projectId: string; file: File },
  signal?: AbortSignal,
): Promise<DxfFile> {
  const form = new FormData();
  form.append('file', args.file);
  const res = await api.post<{ data: { dxfFile: DxfFile } }>(
    `/projects/${args.projectId}/dxf`,
    form,
    { signal, headers: { 'Content-Type': 'multipart/form-data' } },
  );
  return res.data.data.dxfFile;
}

export async function listProjectDxfFiles(
  projectId: string,
  signal?: AbortSignal,
): Promise<ListDxfFilesResponse> {
  const res = await api.get<{ data: ListDxfFilesResponse }>(
    `/projects/${projectId}/dxf`,
    { signal },
  );
  return res.data.data;
}

export async function getDxfFile(id: string, signal?: AbortSignal): Promise<DxfFile> {
  const res = await api.get<{ data: { dxfFile: DxfFile } }>(`/dxf/${id}`, { signal });
  return res.data.data.dxfFile;
}
