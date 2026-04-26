import { auth } from './auth.middleware';
import * as userDa from '../api/data-access/user.da';
import * as authCookie from '../integrations/auth-cookie';
import type { Request, Response, NextFunction } from 'express';

jest.mock('../api/data-access/user.da');
jest.mock('../integrations/auth-cookie');

const mockedFindUserById = userDa.findUserById as jest.MockedFunction<typeof userDa.findUserById>;
const mockedVerifyToken = authCookie.verifyToken as jest.MockedFunction<typeof authCookie.verifyToken>;
const mockedClear = authCookie.clearAuthCookie as jest.MockedFunction<typeof authCookie.clearAuthCookie>;

const makeRes = () => {
    const res: Partial<Response> = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    res.clearCookie = jest.fn();
    return res as Response;
};

describe('auth middleware', () => {
    afterEach(() => jest.clearAllMocks());

    it('401 when no auth cookie', async () => {
        const req = { cookies: {} } as unknown as Request;
        const res = makeRes();
        const next = jest.fn();
        await auth(req, res, next as NextFunction);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ message: 'Unauthenticated' });
        expect(next).not.toHaveBeenCalled();
    });

    it('401 + clear cookie when token is invalid', async () => {
        const req = { cookies: { auth: 'bad' } } as unknown as Request;
        const res = makeRes();
        mockedVerifyToken.mockReturnValueOnce(null);
        await auth(req, res, jest.fn() as unknown as NextFunction);
        expect(mockedClear).toHaveBeenCalledWith(res);
        expect(res.status).toHaveBeenCalledWith(401);
    });

    it('401 + clear cookie when user no longer exists', async () => {
        const req = { cookies: { auth: 'ok' } } as unknown as Request;
        const res = makeRes();
        mockedVerifyToken.mockReturnValueOnce({ sub: 'gone' });
        mockedFindUserById.mockResolvedValueOnce(null);
        await auth(req, res, jest.fn() as unknown as NextFunction);
        expect(mockedClear).toHaveBeenCalledWith(res);
        expect(res.status).toHaveBeenCalledWith(401);
    });

    it('401 + clear cookie when user isActive=false', async () => {
        const req = { cookies: { auth: 'ok' } } as unknown as Request;
        const res = makeRes();
        mockedVerifyToken.mockReturnValueOnce({ sub: 'u' });
        mockedFindUserById.mockResolvedValueOnce({
            id: 'u', email: 'a@b.com', name: 'A', passwordHash: 'x',
            role: 'USER', isActive: false, createdAt: new Date(), updatedAt: new Date(),
        } as never);
        await auth(req, res, jest.fn() as unknown as NextFunction);
        expect(mockedClear).toHaveBeenCalledWith(res);
        expect(res.status).toHaveBeenCalledWith(401);
    });

    it('sets req.user and calls next on success', async () => {
        const req = { cookies: { auth: 'ok' } } as unknown as Request;
        const res = makeRes();
        const next = jest.fn();
        mockedVerifyToken.mockReturnValueOnce({ sub: 'u' });
        mockedFindUserById.mockResolvedValueOnce({
            id: 'u', email: 'a@b.com', name: 'A', passwordHash: 'x',
            role: 'USER', isActive: true, createdAt: new Date(), updatedAt: new Date(),
        } as never);
        await auth(req, res, next as NextFunction);
        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
        expect(req.user).toEqual({ id: 'u', email: 'a@b.com', name: 'A', role: 'USER' });
    });
});
