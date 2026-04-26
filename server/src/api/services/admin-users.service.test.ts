import {
    listUsers as listUsersSvc,
    createUser as createUserSvc,
    deleteUser,
    resetPassword,
    setActive,
} from './admin-users.service';
import { HttpError } from '../../lib/HttpError';
import * as da from '../data-access/user.da';
import * as password from '../../integrations/password';

jest.mock('../data-access/user.da');
jest.mock('../../integrations/password');
jest.mock('./audit-log.service', () => ({ record: jest.fn() }));

const mockedCreate = da.createUser as jest.MockedFunction<typeof da.createUser>;
const mockedFindById = da.findUserById as jest.MockedFunction<typeof da.findUserById>;
const mockedDelete = da.deleteUserById as jest.MockedFunction<typeof da.deleteUserById>;
const mockedUpdatePw = da.updateUserPassword as jest.MockedFunction<typeof da.updateUserPassword>;
const mockedSetActive = da.setUserActive as jest.MockedFunction<typeof da.setUserActive>;
const mockedList = da.listUsers as jest.MockedFunction<typeof da.listUsers>;
const mockedHash = password.hash as jest.MockedFunction<typeof password.hash>;

const USER = {
    id: 'u', email: 'u@ex.com', name: 'U', passwordHash: 'h',
    role: 'USER' as const, isActive: true,
    createdAt: new Date(), updatedAt: new Date(),
};
const ADMIN = { ...USER, id: 'a', email: 'a@ex.com', role: 'ADMIN' as const };

describe('admin-users.service', () => {
    afterEach(() => jest.clearAllMocks());

    describe('listUsers', () => {
        it('delegates to DA', async () => {
            mockedList.mockResolvedValueOnce({ users: [USER], nextCursor: null });
            const r = await listUsersSvc({ limit: 10 });
            expect(r.users.length).toBe(1);
            expect(mockedList).toHaveBeenCalledWith({ limit: 10, cursor: undefined, q: undefined });
        });
    });

    describe('createUser', () => {
        it('hashes password and hardcodes role=USER', async () => {
            mockedHash.mockResolvedValueOnce('hashed');
            mockedCreate.mockResolvedValueOnce(USER);
            await createUserSvc({
                email: 'u@ex.com', name: 'U', initialPassword: 'pw12345678',
            }, 'admin-id');
            expect(mockedHash).toHaveBeenCalledWith('pw12345678');
            expect(mockedCreate).toHaveBeenCalledWith({
                email: 'u@ex.com', name: 'U', passwordHash: 'hashed', role: 'USER',
            });
        });

        it('rethrows 409 on Prisma P2002 (unique email)', async () => {
            mockedHash.mockResolvedValueOnce('x');
            mockedCreate.mockRejectedValueOnce({ code: 'P2002' });
            await expect(
                createUserSvc({ email: 'u@ex.com', name: 'U', initialPassword: 'pw12345678' }, 'actor'),
            ).rejects.toMatchObject({ statusCode: 409, message: 'email_in_use' });
        });
    });

    describe('deleteUser', () => {
        it('404 when user missing', async () => {
            mockedFindById.mockResolvedValueOnce(null);
            await expect(deleteUser('gone', 'actor')).rejects.toMatchObject({ statusCode: 404 });
        });
        it('403 admin_target_forbidden when target is ADMIN', async () => {
            mockedFindById.mockResolvedValueOnce(ADMIN);
            await expect(deleteUser(ADMIN.id, 'actor')).rejects.toMatchObject({
                statusCode: 403, message: 'admin_target_forbidden',
            });
        });
        it('403 when target is self', async () => {
            mockedFindById.mockResolvedValueOnce(USER);
            await expect(deleteUser(USER.id, USER.id)).rejects.toMatchObject({ statusCode: 403 });
        });
        it('deletes on happy path', async () => {
            mockedFindById.mockResolvedValueOnce(USER);
            await deleteUser(USER.id, 'actor');
            expect(mockedDelete).toHaveBeenCalledWith(USER.id);
        });
    });

    describe('resetPassword', () => {
        it('404 when user missing', async () => {
            mockedFindById.mockResolvedValueOnce(null);
            await expect(resetPassword('gone', 'newpwd1234', 'actor')).rejects.toMatchObject({ statusCode: 404 });
        });
        it('403 admin_target_forbidden when target is ADMIN', async () => {
            mockedFindById.mockResolvedValueOnce(ADMIN);
            await expect(resetPassword(ADMIN.id, 'newpwd1234', 'actor')).rejects.toMatchObject({
                statusCode: 403, message: 'admin_target_forbidden',
            });
        });
        it('hashes and updates password on happy path', async () => {
            mockedFindById.mockResolvedValueOnce(USER);
            mockedHash.mockResolvedValueOnce('new-hash');
            await resetPassword(USER.id, 'newpwd1234', 'actor');
            expect(mockedHash).toHaveBeenCalledWith('newpwd1234');
            expect(mockedUpdatePw).toHaveBeenCalledWith(USER.id, 'new-hash');
        });
    });

    describe('setActive', () => {
        it('404 when user missing', async () => {
            mockedFindById.mockResolvedValueOnce(null);
            await expect(setActive('gone', false, 'actor')).rejects.toMatchObject({ statusCode: 404 });
        });
        it('403 when target is ADMIN', async () => {
            mockedFindById.mockResolvedValueOnce(ADMIN);
            await expect(setActive(ADMIN.id, false, 'actor')).rejects.toMatchObject({
                statusCode: 403, message: 'admin_target_forbidden',
            });
        });
        it('403 when disabling self', async () => {
            mockedFindById.mockResolvedValueOnce(USER);
            await expect(setActive(USER.id, false, USER.id)).rejects.toMatchObject({ statusCode: 403 });
        });
        it('allows re-enabling self (only disable-self is forbidden)', async () => {
            mockedFindById.mockResolvedValueOnce({ ...USER, isActive: false });
            mockedSetActive.mockResolvedValueOnce(USER);
            await expect(setActive(USER.id, true, USER.id)).resolves.toEqual(USER);
        });
        it('flips isActive on happy path (not self)', async () => {
            mockedFindById.mockResolvedValueOnce(USER);
            mockedSetActive.mockResolvedValueOnce({ ...USER, isActive: false });
            const r = await setActive(USER.id, false, 'actor');
            expect(r.isActive).toBe(false);
            expect(mockedSetActive).toHaveBeenCalledWith(USER.id, false);
        });
    });
});

void HttpError;
