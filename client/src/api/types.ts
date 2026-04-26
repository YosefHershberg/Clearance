export type Role = 'ADMIN' | 'USER';

export type User = {
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
};

export type AdminStats = {
  userCount: number;
  projectCount: number;
  analysisCount: number;
};

export type ListUsersResponse = {
  users: User[];
  nextCursor?: string;
};

export type Project = {
  id: string;
  ownerId: string;
  name: string;
  description: string | null;
  locality: string | null;
  createdAt: string;
  updatedAt: string;
  owner?: { id: string; email: string; name: string };
};

export type ListProjectsResponse = {
  projects: Project[];
  nextCursor?: string;
};

export type ExtractionStatus = 'PENDING' | 'EXTRACTING' | 'COMPLETED' | 'FAILED';

export type SheetClassification =
  | 'INDEX_PAGE'
  | 'FLOOR_PLAN'
  | 'CROSS_SECTION'
  | 'ELEVATION'
  | 'PARKING_SECTION'
  | 'SURVEY'
  | 'SITE_PLAN'
  | 'ROOF_PLAN'
  | 'AREA_CALCULATION'
  | 'UNCLASSIFIED';

export type SheetRender = {
  id: string;
  sheetIndex: number;
  displayName: string;
  classification: SheetClassification;
  geometryBlock: string | null;
  annotationBlock: string | null;
  svgWarning: string | null;
  filename: string;
};

export type DxfFile = {
  id: string;
  projectId: string;
  originalName: string;
  sha256: string;
  sizeBytes: number;
  extractionStatus: ExtractionStatus;
  extractionError: string | null;
  structuralHash: string | null;
  createdAt: string;
  sheetRenders?: SheetRender[];
};

export type ListDxfFilesResponse = {
  dxfFiles: DxfFile[];
};
