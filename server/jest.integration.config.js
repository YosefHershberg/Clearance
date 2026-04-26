/** @type {import('jest').Config} */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/src'],
    testMatch: ['**/*.integration.test.ts'],
    testPathIgnorePatterns: ['/node_modules/', '/dist/'],
    testTimeout: 30000,
    // Integration tests share a single database. Running them in parallel causes
    // one suite's truncateAll() to wipe another suite's data mid-test.
    maxWorkers: 1,
    // Prisma v7's generated client imports with `.js` extensions even in CJS mode.
    // Strip the extension so ts-jest resolves to the actual .ts source.
    moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1',
    },
};
