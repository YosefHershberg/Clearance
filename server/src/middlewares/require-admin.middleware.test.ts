import { requireAdmin } from './require-admin.middleware';
import type { Request, Response, NextFunction } from 'express';

const makeRes = () => {
    const res: Partial<Response> = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res as Response;
};

describe('requireAdmin middleware', () => {
    it('403 when req.user is missing', () => {
        const res = makeRes();
        const next = jest.fn();
        requireAdmin({} as Request, res, next as NextFunction);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({ message: 'Forbidden' });
        expect(next).not.toHaveBeenCalled();
    });

    it('403 when req.user.role is USER', () => {
        const req = { user: { id: 'u', email: 'a@b', name: 'A', role: 'USER' as const } } as unknown as Request;
        const res = makeRes();
        const next = jest.fn();
        requireAdmin(req, res, next as NextFunction);
        expect(res.status).toHaveBeenCalledWith(403);
    });

    it('calls next when req.user.role is ADMIN', () => {
        const req = { user: { id: 'u', email: 'a@b', name: 'A', role: 'ADMIN' as const } } as unknown as Request;
        const res = makeRes();
        const next = jest.fn();
        requireAdmin(req, res, next as NextFunction);
        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
    });
});
