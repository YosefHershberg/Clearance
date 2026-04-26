import { z } from 'zod';
import { validate } from './validate.middleware';
import type { Request, Response, NextFunction } from 'express';

const makeRes = () => {
    const res: Partial<Response> = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res as Response;
};

describe('validate middleware', () => {
    const schema = z.object({
        body: z.object({ name: z.string() }),
        query: z.object({}),
        params: z.object({}),
    });

    it('calls next when the schema parses', () => {
        const req = { body: { name: 'x' }, query: {}, params: {} } as Request;
        const res = makeRes();
        const next = jest.fn();
        validate(schema)(req, res, next as NextFunction);
        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
    });

    it('returns 400 with details on ZodError', () => {
        const req = { body: {}, query: {}, params: {} } as Request;
        const res = makeRes();
        const next = jest.fn();
        validate(schema)(req, res, next as NextFunction);
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({ error: 'Invalid data', details: expect.any(Array) }),
        );
    });

    it('writes coerced query values back onto req.query', () => {
        const coerceSchema = z.object({
            body: z.object({}),
            query: z.object({ limit: z.coerce.number() }),
            params: z.object({}),
        });
        const req = { body: {}, query: { limit: '20' }, params: {} } as unknown as Request;
        const res = makeRes();
        const next = jest.fn();
        validate(coerceSchema)(req, res, next as NextFunction);
        expect(next).toHaveBeenCalledTimes(1);
        expect(req.query.limit).toBe(20);
    });

    it('writes schema defaults onto req.query', () => {
        const defaultSchema = z.object({
            body: z.object({}),
            query: z.object({ limit: z.coerce.number().default(25) }),
            params: z.object({}),
        });
        const req = { body: {}, query: {}, params: {} } as unknown as Request;
        const res = makeRes();
        const next = jest.fn();
        validate(defaultSchema)(req, res, next as NextFunction);
        expect(next).toHaveBeenCalledTimes(1);
        expect(req.query.limit).toBe(25);
    });

    it('writes parsed body values back onto req.body', () => {
        const bodySchema = z.object({
            body: z.strictObject({ count: z.coerce.number() }),
            query: z.object({}),
            params: z.object({}),
        });
        const req = { body: { count: '7' }, query: {}, params: {} } as Request;
        const res = makeRes();
        const next = jest.fn();
        validate(bodySchema)(req, res, next as NextFunction);
        expect(next).toHaveBeenCalledTimes(1);
        expect(req.body).toEqual({ count: 7 });
    });
});
