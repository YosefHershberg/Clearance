import bcrypt from 'bcryptjs';

const BCRYPT_COST = 10;

export async function hash(plaintext: string): Promise<string> {
    return bcrypt.hash(plaintext, BCRYPT_COST);
}

export async function compare(plaintext: string, hashed: string): Promise<boolean> {
    return bcrypt.compare(plaintext, hashed);
}
