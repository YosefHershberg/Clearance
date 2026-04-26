import { HttpError } from '../../lib/HttpError';
import { hash } from '../../integrations/password';
import {
    createUser as daCreate,
    deleteUserById,
    findUserById,
    listUsers as daList,
    setUserActive,
    updateUserPassword,
    type ListUsersParams,
    type ListUsersResult,
} from '../data-access/user.da';
import type { User } from '../../generated/prisma/client';

export async function listUsers(params: ListUsersParams): Promise<ListUsersResult> {
    return daList({ limit: params.limit, cursor: params.cursor, q: params.q });
}

export type AdminCreateUserInput = {
    email: string;
    name: string;
    initialPassword: string;
};

export async function createUser(input: AdminCreateUserInput, _actorId: string): Promise<User> {
    const passwordHash = await hash(input.initialPassword);
    try {
        return await daCreate({
            email: input.email,
            name: input.name,
            passwordHash,
            role: 'USER',
        });
    } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        if (code === 'P2002') {
            throw new HttpError(409, 'email_in_use');
        }
        throw err;
    }
}

async function loadAndGuard(targetId: string, actorId: string, forbidSelf: boolean): Promise<User> {
    const user = await findUserById(targetId);
    if (!user) throw new HttpError(404, 'User not found');
    if (user.role === 'ADMIN') throw new HttpError(403, 'admin_target_forbidden');
    if (forbidSelf && targetId === actorId) throw new HttpError(403, 'self_target_forbidden');
    return user;
}

export async function deleteUser(targetId: string, actorId: string): Promise<void> {
    await loadAndGuard(targetId, actorId, true);
    await deleteUserById(targetId);
}

export async function resetPassword(targetId: string, newPassword: string, actorId: string): Promise<void> {
    await loadAndGuard(targetId, actorId, false);
    const newHash = await hash(newPassword);
    await updateUserPassword(targetId, newHash);
}

export async function setActive(targetId: string, isActive: boolean, actorId: string): Promise<User> {
    await loadAndGuard(targetId, actorId, !isActive);
    return setUserActive(targetId, isActive);
}
