import type { Request, Response } from 'express';
import { healthCheck } from './healthCheck.controller';

describe('healthCheck controller', () => {
    it('responds with { status: "ok" }', () => {
        const json = jest.fn();
        const req = {} as Request;
        const res = { json } as unknown as Response;

        healthCheck(req, res);

        expect(json).toHaveBeenCalledTimes(1);
        expect(json).toHaveBeenCalledWith({ status: 'ok' });
    });
});
