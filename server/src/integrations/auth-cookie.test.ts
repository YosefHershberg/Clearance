import { signToken, verifyToken, setAuthCookie, clearAuthCookie } from './auth-cookie';
import type { Response } from 'express';

describe('auth-cookie integration', () => {
    it('signs and verifies a token roundtrip', () => {
        const token = signToken('user-123');
        expect(typeof token).toBe('string');
        expect(verifyToken(token)).toEqual({ sub: 'user-123' });
    });

    it('returns null for an invalid token', () => {
        expect(verifyToken('not-a-valid-token')).toBeNull();
    });

    it('returns null for a token signed with a different secret', () => {
        // valid JWT format, different secret, wrong signature
        const tamperable =
            'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.invalid-signature';
        expect(verifyToken(tamperable)).toBeNull();
    });

    it('setAuthCookie calls res.cookie with httpOnly + strict + path /', () => {
        const cookie = jest.fn();
        const res = { cookie } as unknown as Response;
        setAuthCookie(res, 'user-123');
        expect(cookie).toHaveBeenCalledTimes(1);
        const [name, value, opts] = cookie.mock.calls[0];
        expect(name).toBe('auth');
        expect(typeof value).toBe('string');
        expect(opts).toEqual(
            expect.objectContaining({
                httpOnly: true,
                sameSite: 'strict',
                path: '/',
                maxAge: 604800000,
            }),
        );
    });

    it('clearAuthCookie calls res.clearCookie with matching options', () => {
        const clearCookie = jest.fn();
        const res = { clearCookie } as unknown as Response;
        clearAuthCookie(res);
        expect(clearCookie).toHaveBeenCalledWith(
            'auth',
            expect.objectContaining({ httpOnly: true, sameSite: 'strict', path: '/' }),
        );
    });
});
