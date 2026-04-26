import jwt from 'jsonwebtoken';
import env from '../utils/env';
import type { Response } from 'express';

const COOKIE_NAME = 'auth';
const TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export function signToken(userId: string): string {
    return jwt.sign({ sub: userId }, env.JWT_SECRET, { expiresIn: TTL_SECONDS });
}

export function verifyToken(token: string): { sub: string } | null {
    try {
        const payload = jwt.verify(token, env.JWT_SECRET) as { sub?: string };
        if (typeof payload.sub !== 'string') return null;
        return { sub: payload.sub };
    } catch {
        return null;
    }
}

export function setAuthCookie(res: Response, userId: string): void {
    const token = signToken(userId);
    res.cookie(COOKIE_NAME, token, {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/',
        maxAge: TTL_SECONDS * 1000,
    });
}

export function clearAuthCookie(res: Response): void {
    res.clearCookie(COOKIE_NAME, {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/',
    });
}
