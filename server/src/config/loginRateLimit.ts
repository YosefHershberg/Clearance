import rateLimit from 'express-rate-limit';

/**
 * Per-IP rate limit for POST /api/auth/login (spec §2.6): 10 attempts / 15 min.
 */
const loginRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many login attempts, try again in 15 minutes' },
});

export default loginRateLimit;
