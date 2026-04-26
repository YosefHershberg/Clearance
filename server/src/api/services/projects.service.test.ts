import {
    createProject,
    listProjectsFor,
    getProject,
    patchProject,
    softDeleteProject,
} from './projects.service';
import * as da from '../data-access/projects.da';
import { record as auditRecord } from './audit-log.service';

jest.mock('../data-access/projects.da');
jest.mock('./audit-log.service', () => ({ record: jest.fn() }));

const mockedCreate = da.createProject as jest.MockedFunction<typeof da.createProject>;
const mockedList = da.listProjects as jest.MockedFunction<typeof da.listProjects>;
const mockedGetById = da.getProjectById as jest.MockedFunction<typeof da.getProjectById>;
const mockedPatch = da.patchProject as jest.MockedFunction<typeof da.patchProject>;
const mockedSoftDelete = da.softDeleteProject as jest.MockedFunction<typeof da.softDeleteProject>;
const mockedAudit = auditRecord as jest.MockedFunction<typeof auditRecord>;

const USER = { id: 'u1', role: 'USER' as const };
const ADMIN = { id: 'a1', role: 'ADMIN' as const };

const OWNER_SUMMARY = { id: 'u1', email: 'u@ex.com', name: 'U' };

function projectRow(overrides: Partial<{ id: string; ownerId: string; deletedAt: Date | null }> = {}) {
    return {
        id: overrides.id ?? 'p1',
        ownerId: overrides.ownerId ?? USER.id,
        name: 'Proj',
        description: null,
        locality: null,
        deletedAt: overrides.deletedAt ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
        owner: { ...OWNER_SUMMARY, id: overrides.ownerId ?? USER.id },
    };
}

describe('projects.service', () => {
    afterEach(() => jest.clearAllMocks());

    describe('createProject', () => {
        it('delegates to DA with ownerId + writes audit', async () => {
            mockedCreate.mockResolvedValueOnce(projectRow());
            await createProject(USER.id, { name: 'Proj' });
            expect(mockedCreate).toHaveBeenCalledWith({ ownerId: USER.id, name: 'Proj' });
            expect(mockedAudit).toHaveBeenCalledWith(
                expect.objectContaining({ event: 'project.created', entityId: 'p1' }),
            );
        });
    });

    describe('listProjectsFor', () => {
        beforeEach(() => {
            mockedList.mockResolvedValueOnce({ projects: [], nextCursor: undefined });
        });

        it('USER sees only own projects regardless of all flag', async () => {
            await listProjectsFor(USER, { limit: 20, all: true });
            expect(mockedList).toHaveBeenCalledWith(
                expect.objectContaining({ ownerId: USER.id }),
            );
        });

        it('ADMIN without all flag sees own projects only', async () => {
            await listProjectsFor(ADMIN, { limit: 20 });
            expect(mockedList).toHaveBeenCalledWith(
                expect.objectContaining({ ownerId: ADMIN.id }),
            );
        });

        it('ADMIN with all flag sees all projects (ownerId undefined)', async () => {
            await listProjectsFor(ADMIN, { limit: 20, all: true });
            expect(mockedList).toHaveBeenCalledWith(
                expect.objectContaining({ ownerId: undefined }),
            );
        });
    });

    describe('getProject', () => {
        it('404 when not found', async () => {
            mockedGetById.mockResolvedValueOnce(null);
            await expect(getProject(USER, 'gone')).rejects.toMatchObject({ statusCode: 404 });
        });

        it('403 for cross-owner non-admin', async () => {
            mockedGetById.mockResolvedValueOnce(projectRow({ ownerId: 'other' }));
            await expect(getProject(USER, 'p1')).rejects.toMatchObject({ statusCode: 403 });
        });

        it('returns project for admin viewing another owner', async () => {
            const row = projectRow({ ownerId: 'other' });
            mockedGetById.mockResolvedValueOnce(row);
            const r = await getProject(ADMIN, 'p1');
            expect(r.id).toBe('p1');
        });

        it('returns project for owner', async () => {
            mockedGetById.mockResolvedValueOnce(projectRow());
            const r = await getProject(USER, 'p1');
            expect(r.id).toBe('p1');
        });
    });

    describe('patchProject', () => {
        it('records changed fields in audit metadata', async () => {
            mockedGetById.mockResolvedValueOnce(projectRow());
            mockedPatch.mockResolvedValueOnce(projectRow());
            await patchProject(USER, 'p1', { name: 'New', description: null });
            expect(mockedPatch).toHaveBeenCalledWith('p1', { name: 'New', description: null });
            expect(mockedAudit).toHaveBeenCalledWith(
                expect.objectContaining({
                    event: 'project.updated',
                    metadata: { fields: ['name', 'description'] },
                }),
            );
        });
    });

    describe('softDeleteProject', () => {
        it('404 when not found', async () => {
            mockedGetById.mockResolvedValueOnce(null);
            await expect(softDeleteProject(USER, 'gone')).rejects.toMatchObject({ statusCode: 404 });
        });

        it('403 for cross-owner non-admin', async () => {
            mockedGetById.mockResolvedValueOnce(projectRow({ ownerId: 'other' }));
            await expect(softDeleteProject(USER, 'p1')).rejects.toMatchObject({ statusCode: 403 });
        });

        it('soft-deletes + writes audit on happy path', async () => {
            mockedGetById.mockResolvedValueOnce(projectRow());
            mockedSoftDelete.mockResolvedValueOnce(projectRow());
            await softDeleteProject(USER, 'p1');
            expect(mockedSoftDelete).toHaveBeenCalledWith('p1');
            expect(mockedAudit).toHaveBeenCalledWith(
                expect.objectContaining({ event: 'project.deleted', entityId: 'p1' }),
            );
        });
    });
});
