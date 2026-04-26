import prisma from './prisma';
import logger from './logger';

export const connectToDatabase = async (): Promise<void> => {
    try {
        await prisma.$connect();
        // $connect() with the pg driver adapter only initializes the pool —
        // it does not open a TCP connection. Force a real round-trip so a
        // missing/unreachable database fails fast at startup.
        await prisma.$queryRaw`SELECT 1`;
        logger.info('Connected to the database');
    } catch (error) {
        logger.error('Failed to connect to the database:', error);
        throw error;
    }
};

export const disconnectFromDatabase = async (): Promise<void> => {
    try {
        await prisma.$disconnect();
        logger.info('Disconnected from the database');
    } catch (error) {
        logger.error('Failed to disconnect from the database:', error);
        throw error;
    }
};
