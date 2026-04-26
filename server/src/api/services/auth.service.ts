import { HttpError } from '../../lib/HttpError';
import { hash, compare } from '../../integrations/password';
import {
    findUserByEmail,
    findUserById,
    updateUserPassword,
} from '../data-access/user.da';
import type { UserRole } from '../../generated/prisma/client';

export type AuthUser = {
    id: string;
    email: string;
    name: string;
    role: UserRole;
};

export async function login(email: string, password: string): Promise<AuthUser> {
    const user = await findUserByEmail(email);
    if (!user || !user.isActive) {
        throw new HttpError(401, 'Invalid credentials');
    }
    const ok = await compare(password, user.passwordHash);
    if (!ok) {
        throw new HttpError(401, 'Invalid credentials');
    }
    return { id: user.id, email: user.email, name: user.name, role: user.role };
}

export async function changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
): Promise<void> {
    const user = await findUserById(userId);
    if (!user) {
        throw new HttpError(404, 'User not found');
    }
    const ok = await compare(currentPassword, user.passwordHash);
    if (!ok) {
        throw new HttpError(401, 'Invalid credentials');
    }
    const newHash = await hash(newPassword);
    await updateUserPassword(userId, newHash);
}
