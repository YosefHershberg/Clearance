import { HttpError } from './HttpError';

describe('HttpError', () => {
    it('stores the status code passed to the constructor', () => {
        const err = new HttpError(404, 'Not found');
        expect(err.statusCode).toBe(404);
    });

    it('uses the message passed to the constructor', () => {
        const err = new HttpError(500, 'Server exploded');
        expect(err.message).toBe('Server exploded');
    });

    it('is an instance of Error', () => {
        const err = new HttpError(400, 'Bad request');
        expect(err).toBeInstanceOf(Error);
        expect(err).toBeInstanceOf(HttpError);
    });

    it('has a stack trace', () => {
        const err = new HttpError(418, "I'm a teapot");
        expect(typeof err.stack).toBe('string');
        expect(err.stack).toContain('HttpError');
    });
});
