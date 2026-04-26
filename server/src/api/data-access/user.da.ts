import prisma from '../../config/prisma';
import type { User, UserRole } from '../../generated/prisma/client';

export type CreateUserInput = {
    email: string;
    name: string;
    passwordHash: string;
    role: UserRole;
};

export async function createUser(input: CreateUserInput): Promise<User> {
    return prisma.user.create({ data: input });
}

export async function findUserByEmail(email: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { email } });
}

export async function findUserById(id: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { id } });
}

export async function updateUserPassword(id: string, passwordHash: string): Promise<void> {
    await prisma.user.update({ where: { id }, data: { passwordHash } });
}

export async function setUserActive(id: string, isActive: boolean): Promise<User> {
    return prisma.user.update({ where: { id }, data: { isActive } });
}

export async function deleteUserById(id: string): Promise<void> {
    await prisma.user.delete({ where: { id } });
}

export type ListUsersParams = {
    limit: number;
    cursor?: string;
    q?: string;
};

export type ListUsersResult = {
    users: User[];
    nextCursor: string | null;
};

export async function listUsers(params: ListUsersParams): Promise<ListUsersResult> {
    const { limit, cursor, q } = params;
    const where = q
        ? {
              OR: [
                  { email: { contains: q, mode: 'insensitive' as const } },
                  { name: { contains: q, mode: 'insensitive' as const } },
              ],
          }
        : {};

    const users = await prisma.user.findMany({
        where,
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { createdAt: 'desc' },
    });

    const hasMore = users.length > limit;
    const slice = hasMore ? users.slice(0, limit) : users;
    return { users: slice, nextCursor: hasMore ? slice[slice.length - 1].id : null };
}
