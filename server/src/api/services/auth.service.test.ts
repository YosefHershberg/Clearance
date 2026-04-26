import { login, changePassword } from './auth.service';
import { HttpError } from '../../lib/HttpError';
import * as userDa from '../data-access/user.da';
import * as password from '../../integrations/password';

jest.mock('../data-access/user.da');
jest.mock('../../integrations/password');

const mockedFindByEmail = userDa.findUserByEmail as jest.MockedFunction<typeof userDa.findUserByEmail>;
const mockedFindById = userDa.findUserById as jest.MockedFunction<typeof userDa.findUserById>;
const mockedUpdatePw = userDa.updateUserPassword as jest.MockedFunction<typeof userDa.updateUserPassword>;
const mockedCompare = password.compare as jest.MockedFunction<typeof password.compare>;
const mockedHash = password.hash as jest.MockedFunction<typeof password.hash>;

const fixtureUser = {
    id: 'u', email: 'a@b.com', name: 'A', passwordHash: 'hashed',
    role: 'USER' as const, isActive: true,
    createdAt: new Date(), updatedAt: new Date(),
};

describe('auth.service', () => {
    afterEach(() => jest.clearAllMocks());

    describe('login', () => {
        it('throws 401 "Invalid credentials" when user missing', async () => {
            mockedFindByEmail.mockResolvedValueOnce(null);
            await expect(login('a@b.com', 'x')).rejects.toMatchObject({
                statusCode: 401, message: 'Invalid credentials',
            });
        });

        it('throws 401 "Invalid credentials" when user inactive', async () => {
            mockedFindByEmail.mockResolvedValueOnce({ ...fixtureUser, isActive: false });
            await expect(login('a@b.com', 'x')).rejects.toMatchObject({
                statusCode: 401, message: 'Invalid credentials',
            });
        });

        it('throws 401 "Invalid credentials" when password mismatch', async () => {
            mockedFindByEmail.mockResolvedValueOnce(fixtureUser);
            mockedCompare.mockResolvedValueOnce(false);
            await expect(login('a@b.com', 'x')).rejects.toMatchObject({
                statusCode: 401, message: 'Invalid credentials',
            });
        });

        it('returns trimmed user on success', async () => {
            mockedFindByEmail.mockResolvedValueOnce(fixtureUser);
            mockedCompare.mockResolvedValueOnce(true);
            const u = await login('a@b.com', 'x');
            expect(u).toEqual({ id: 'u', email: 'a@b.com', name: 'A', role: 'USER' });
        });
    });

    describe('changePassword', () => {
        it('throws 401 when current password wrong', async () => {
            mockedFindById.mockResolvedValueOnce(fixtureUser);
            mockedCompare.mockResolvedValueOnce(false);
            await expect(changePassword('u', 'old', 'newpassword')).rejects.toMatchObject({
                statusCode: 401, message: 'Invalid credentials',
            });
            expect(mockedUpdatePw).not.toHaveBeenCalled();
        });

        it('hashes the new password and persists it', async () => {
            mockedFindById.mockResolvedValueOnce(fixtureUser);
            mockedCompare.mockResolvedValueOnce(true);
            mockedHash.mockResolvedValueOnce('newhash');
            await changePassword('u', 'old', 'newpassword');
            expect(mockedHash).toHaveBeenCalledWith('newpassword');
            expect(mockedUpdatePw).toHaveBeenCalledWith('u', 'newhash');
        });

        it('throws 404 when user is missing (shouldn\'t happen post-auth, but defensive)', async () => {
            mockedFindById.mockResolvedValueOnce(null);
            await expect(changePassword('gone', 'old', 'new')).rejects.toMatchObject({
                statusCode: 404,
            });
        });
    });
});

// make TS happy about unused imports
void HttpError;
