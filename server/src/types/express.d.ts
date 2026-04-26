import type { UserRole } from '../generated/prisma/client';

declare global {
    namespace Express {
        interface Request {
            id: string;
            user?: {
                id: string;
                email: string;
                name: string;
                role: UserRole;
            };
        }
    }
}

export {};
