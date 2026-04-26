import { HttpError } from '../lib/HttpError';
import { errorHandler } from './error-handler.middleware';
import type { Request, Response, NextFunction } from 'express';

const makeRes = () => {
    const res: Partial<Response> = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res as Response;
};

describe('errorHandler', () => {
    it('maps HttpError to its status + message', () => {
        const res = makeRes();
        errorHandler(new HttpError(404, 'not here'), {} as Request, res, jest.fn() as unknown as NextFunction);
        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.json).toHaveBeenCalledWith({ message: 'not here' });
    });

    it('maps unknown Error to 500 with message', () => {
        const res = makeRes();
        errorHandler(new Error('boom'), {} as Request, res, jest.fn() as unknown as NextFunction);
        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({ message: 'boom' }),
        );
    });
});
