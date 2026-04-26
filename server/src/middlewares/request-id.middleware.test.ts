import { requestId } from './request-id.middleware';
import type { Request, Response, NextFunction } from 'express';

describe('requestId middleware', () => {
    it('attaches a UUID to req.id and sets X-Request-Id header', () => {
        const setHeader = jest.fn();
        const next = jest.fn();
        const req = {} as Request;
        const res = { setHeader } as unknown as Response;

        requestId(req, res, next as NextFunction);

        expect(req.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        expect(setHeader).toHaveBeenCalledWith('X-Request-Id', req.id);
        expect(next).toHaveBeenCalledTimes(1);
    });

    it('generates a unique id per request', () => {
        const noop = jest.fn();
        const res = { setHeader: noop } as unknown as Response;
        const req1 = {} as Request;
        const req2 = {} as Request;
        requestId(req1, res, noop as NextFunction);
        requestId(req2, res, noop as NextFunction);
        expect(req1.id).not.toBe(req2.id);
    });
});
